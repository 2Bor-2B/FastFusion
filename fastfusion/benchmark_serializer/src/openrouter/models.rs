use serde_json::Value;

use crate::{error::AppError, state::AppState};

pub async fn list(state: &AppState) -> Result<Value, AppError> {
    let url = format!("{}/models", state.config.openrouter_base_url);

    let result = state
        .http
        .get(url)
        .send()
        .await?
        .error_for_status()?
        .json::<Value>()
        .await?;

    Ok(result)
}
