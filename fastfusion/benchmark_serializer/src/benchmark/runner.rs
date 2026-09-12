use futures::future::join_all;

use crate::{
    error::AppError,
    openrouter::{
        self,
        types::{RunInput, RunResult},
    },
    state::AppState,
};

pub async fn run_models(
    state: &AppState,
    models: Vec<String>,
    prompt: String,
) -> Vec<Result<RunResult, AppError>> {
    let futures = models.into_iter().map(|model| {
        openrouter::run(
            state,
            RunInput {
                model,
                prompt: prompt.clone(),
                reasoning_effort: "high".into(),
            },
        )
    });

    join_all(futures).await
}
