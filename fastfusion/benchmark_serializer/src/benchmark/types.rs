use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::scoring::BenchmarkScore;

#[derive(Clone, Debug, Deserialize)]
pub struct BenchmarkCase {
    pub id: String,
    pub category: String,
    pub prompt: String,
    pub expected_contains: Option<String>,
}

#[derive(Debug, Deserialize)]
pub struct BenchmarkRequest {
    pub models: Vec<String>,
    pub cases: Vec<BenchmarkCase>,
    #[serde(default = "default_reasoning_effort")]
    pub reasoning_effort: String,
}

fn default_reasoning_effort() -> String {
    "high".to_string()
}

#[derive(Debug, Serialize)]
pub struct BenchmarkRecord {
    pub model: String,
    pub case_id: String,
    pub category: String,
    pub answer: Option<String>,
    pub reasoning: Option<String>,
    pub reasoning_details: Value,
    pub usage: Value,
    pub latency_ms: u128,
    pub correct: Option<bool>,
    pub score: BenchmarkScore,
}

#[derive(Debug, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum BenchmarkEvent {
    Result {
        record: BenchmarkRecord,
    },
    Error {
        model: String,
        case_id: String,
        error: String,
    },
    Done {
        total_runs: usize,
    },
}

#[cfg(test)]
mod tests {
    use serde_json::{Value, json};

    use super::{BenchmarkEvent, BenchmarkRequest};

    #[test]
    fn request_defaults_reasoning_effort_to_high() {
        let request: BenchmarkRequest = serde_json::from_value(json!({
            "models": ["test/model"],
            "cases": []
        }))
        .unwrap();

        assert_eq!(request.reasoning_effort, "high");
    }

    #[test]
    fn done_event_uses_tagged_ndjson_shape() {
        let value = serde_json::to_value(BenchmarkEvent::Done { total_runs: 6 }).unwrap();

        assert_eq!(value, json!({"type": "done", "total_runs": 6}));
    }

    #[test]
    fn reasoning_details_keep_unknown_fields_when_serialized() {
        let details = json!([{
            "type": "reasoning.text",
            "index": 7,
            "text": "inspect",
            "provider_extension": {"future": true}
        }]);
        let run = crate::openrouter::types::RunResult {
            model: "test/model".into(),
            answer: None,
            reasoning: None,
            reasoning_details: details.clone(),
            usage: Value::Null,
            latency_ms: 1,
        };
        let record = super::BenchmarkRecord {
            model: run.model,
            case_id: "case-1".into(),
            category: "test".into(),
            answer: run.answer,
            reasoning: run.reasoning,
            reasoning_details: run.reasoning_details,
            usage: run.usage,
            latency_ms: run.latency_ms,
            correct: None,
            score: crate::benchmark::scoring::score(
                &crate::openrouter::types::RunResult {
                    model: "test/model".into(),
                    answer: None,
                    reasoning: None,
                    reasoning_details: details.clone(),
                    usage: Value::Null,
                    latency_ms: 1,
                },
                None,
            ),
        };
        let value = serde_json::to_value(BenchmarkEvent::Result { record }).unwrap();

        assert_eq!(value["record"]["reasoning_details"], details);
    }
}
