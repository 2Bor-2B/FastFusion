use std::time::Instant;

use crate::{error::AppError, openrouter::types::*, state::AppState};

pub async fn run(state: &AppState, input: RunInput) -> Result<RunResult, AppError> {
    let request = ChatRequest {
        model: input.model.clone(),

        messages: vec![Message {
            role: "user".into(),
            content: input.prompt,
        }],

        reasoning: ReasoningConfig {
            effort: input.reasoning_effort,
            exclude: false,
        },

        provider: ProviderConfig {
            require_parameters: true,
        },
    };

    let url = format!("{}/chat/completions", state.config.openrouter_base_url);

    let start = Instant::now();

    let response = state
        .http
        .post(url)
        .bearer_auth(&state.config.openrouter_api_key)
        .json(&request)
        .send()
        .await?;

    // Read the body on failure: OpenRouter explains rate limits, unknown model
    // ids and billing problems there, and the status code alone does not.
    let status = response.status();
    if !status.is_success() {
        let body = response.text().await.unwrap_or_default();
        return Err(AppError::upstream(status.as_u16(), &body));
    }

    let response = response.json::<ChatResponse>().await?;

    let latency_ms = start.elapsed().as_millis();

    let choice = response
        .choices
        .into_iter()
        .next()
        .ok_or(AppError::EmptyResponse)?;

    Ok(RunResult {
        model: input.model,
        answer: choice.message.content,
        reasoning: choice.message.reasoning,
        reasoning_details: choice.message.reasoning_details,
        usage: response.usage,
        latency_ms,
    })
}
