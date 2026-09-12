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

    let correct = answer_contains(run.answer.as_deref(), case.expected_contains.as_deref());
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

fn answer_contains(answer: Option<&str>, expected: Option<&str>) -> Option<bool> {
    expected.map(|expected| {
        answer
            .unwrap_or_default()
            .to_lowercase()
            .contains(&expected.to_lowercase())
    })
}

#[cfg(test)]
mod tests {
    use super::answer_contains;

    #[test]
    fn correctness_is_case_insensitive() {
        assert_eq!(
            answer_contains(Some("FINAL: Alice"), Some("alice")),
            Some(true)
        );
    }

    #[test]
    fn missing_answer_is_incorrect_when_expectation_exists() {
        assert_eq!(answer_contains(None, Some("expected")), Some(false));
    }

    #[test]
    fn missing_expectation_is_unscored() {
        assert_eq!(answer_contains(Some("anything"), None), None);
    }
}
