use crate::{
    benchmark::{
        scoring,
        types::{BenchmarkCase, BenchmarkRecord},
    },
    openrouter::{self, types::RunInput},
    state::AppState,
};

pub async fn execute_case(
    state: &AppState,
    model: String,
    case: BenchmarkCase,
    reasoning_effort: String,
) -> Result<BenchmarkRecord, String> {
    let run = openrouter::run(
        state,
        RunInput {
            model,
            prompt: case.prompt,
            reasoning_effort,
        },
    )
    .await
    .map_err(|error| error.to_string())?;

    let correct = case.expected_contains.as_ref().map(|expected| {
        run.answer
            .as_deref()
            .unwrap_or_default()
            .to_lowercase()
            .contains(&expected.to_lowercase())
    });
    let score = scoring::score(&run, correct);

    Ok(BenchmarkRecord {
        model: run.model,
        case_id: case.id,
        category: case.category,
        answer: run.answer,
        reasoning: run.reasoning,
        reasoning_details: run.reasoning_details,
        usage: run.usage,
        latency_ms: run.latency_ms,
        correct,
        score,
    })
}
