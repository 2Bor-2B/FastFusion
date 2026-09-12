use std::{convert::Infallible, sync::Arc};

use axum::{
    Json,
    body::{Body, Bytes},
    extract::State,
    http::{HeaderValue, header},
    response::Response,
};
use futures::{StreamExt, stream::FuturesUnordered};
use serde::Deserialize;
use tokio::sync::mpsc;

use crate::{
    benchmark::{
        self, summary,
        types::{BenchmarkEvent, BenchmarkRecord, BenchmarkRequest, WinnerRef},
    },
    error::AppError,
    openrouter::{
        self,
        types::{RunInput, RunResult},
    },
    state::AppState,
};

#[derive(Debug, Deserialize)]
pub struct LegacyBenchmarkRequest {
    pub models: Vec<String>,
    pub prompt: String,
}

pub async fn run(
    State(state): State<Arc<AppState>>,
    Json(input): Json<RunInput>,
) -> Result<Json<RunResult>, AppError> {
    Ok(Json(openrouter::run(&state, input).await?))
}

pub async fn benchmark(
    State(state): State<Arc<AppState>>,
    Json(input): Json<LegacyBenchmarkRequest>,
) -> Json<Vec<benchmark::scoring::BenchmarkScore>> {
    let mut runs = FuturesUnordered::new();
    for model in input.models {
        runs.push(openrouter::run(
            &state,
            RunInput {
                model,
                prompt: input.prompt.clone(),
                reasoning_effort: "high".into(),
            },
        ));
    }

    let mut scores = Vec::new();
    while let Some(result) = runs.next().await {
        if let Ok(run) = result {
            scores.push(benchmark::scoring::score(&run, None));
        }
    }
    scores.sort_by(|a, b| b.total.total_cmp(&a.total));
    Json(scores)
}

pub async fn benchmark_stream(
    State(state): State<Arc<AppState>>,
    Json(input): Json<BenchmarkRequest>,
) -> Response<Body> {
    let total_runs = input.models.len() * input.cases.len();
    let (sender, receiver) = mpsc::channel::<Bytes>(32);

    tokio::spawn(async move {
        let BenchmarkRequest {
            models,
            cases,
            reasoning_effort,
            summary_model,
        } = input;
        // An empty model id means "no summary", same as omitting the field.
        let summary_model = summary_model.filter(|model| !model.trim().is_empty());

        let mut runs = FuturesUnordered::new();
        for model in models {
            for case in cases.iter().cloned() {
                let state = Arc::clone(&state);
                let effort = reasoning_effort.clone();
                let error_model = model.clone();
                let run_model = model.clone();
                let error_case_id = case.id.clone();
                runs.push(async move {
                    match benchmark::runner::execute_case(&state, run_model, case, effort).await {
                        Ok(record) => BenchmarkEvent::Result { record },
                        Err(error) => BenchmarkEvent::Error {
                            model: error_model,
                            case_id: error_case_id,
                            error,
                        },
                    }
                });
            }
        }

        // Records in finish order: the winner tie-break relies on that order.
        let mut records: Vec<BenchmarkRecord> = Vec::new();
        while let Some(event) = runs.next().await {
            if let BenchmarkEvent::Result { record } = &event {
                records.push(record.clone());
            }
            if send_event(&sender, &event).await.is_err() {
                return;
            }
        }

        if let Some(model) = summary_model
            && let Some(winner) = summary::pick_winner(&records)
        {
            let event = match summary::summarize(&state, &model, winner).await {
                Ok(event) => event,
                Err(error) => BenchmarkEvent::SummaryError {
                    winner: WinnerRef::from(winner),
                    summary_model: model,
                    error,
                },
            };
            if send_event(&sender, &event).await.is_err() {
                return;
            }
        }

        let _ = send_event(&sender, &BenchmarkEvent::Done { total_runs }).await;
    });

    let stream = futures::stream::unfold(receiver, |mut receiver| async move {
        receiver
            .recv()
            .await
            .map(|bytes| (Ok::<_, Infallible>(bytes), receiver))
    });
    let mut response = Response::new(Body::from_stream(stream));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_static("application/x-ndjson"),
    );
    response
}

async fn send_event(
    sender: &mpsc::Sender<Bytes>,
    event: &BenchmarkEvent,
) -> Result<(), mpsc::error::SendError<Bytes>> {
    let mut line = serde_json::to_vec(event).expect("benchmark events are serializable");
    line.push(b'\n');
    sender.send(Bytes::from(line)).await
}
