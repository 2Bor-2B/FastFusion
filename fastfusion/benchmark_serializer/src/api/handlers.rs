use std::sync::Arc;

use axum::{Json, extract::State};

use crate::{
    error::AppError,
    openrouter::{
        self,
        types::{RunInput, RunResult},
    },
    state::AppState,
};

pub async fn run(
    State(state): State<Arc<AppState>>,
    Json(input): Json<RunInput>,
) -> Result<Json<RunResult>, AppError> {
    let result = openrouter::run(&state, input).await?;

    Ok(Json(result))
}
