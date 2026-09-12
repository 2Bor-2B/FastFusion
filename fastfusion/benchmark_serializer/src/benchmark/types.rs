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
