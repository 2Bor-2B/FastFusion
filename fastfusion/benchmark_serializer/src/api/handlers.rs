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
        self,
        types::{BenchmarkEvent, BenchmarkRequest},
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
        let mut runs = FuturesUnordered::new();
        for model in input.models {
            for case in input.cases.iter().cloned() {
                let state = Arc::clone(&state);
                let effort = input.reasoning_effort.clone();
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

        while let Some(event) = runs.next().await {
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

#[cfg(test)]
mod tests {
    use tokio::sync::mpsc;

    use super::send_event;
    use crate::benchmark::types::BenchmarkEvent;

    #[tokio::test]
    async fn send_event_writes_one_json_object_per_line() {
        let (sender, mut receiver) = mpsc::channel(1);

        send_event(&sender, &BenchmarkEvent::Done { total_runs: 3 })
            .await
            .unwrap();

        let line = receiver.recv().await.unwrap();
        assert_eq!(&line[..], b"{\"type\":\"done\",\"total_runs\":3}\n");
    }
}
