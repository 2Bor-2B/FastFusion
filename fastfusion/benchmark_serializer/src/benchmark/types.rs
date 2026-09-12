use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::scoring::BenchmarkScore;
use crate::openrouter::types::RunResult;

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
    /// Optional model asked to synthesize the winning run once every
    /// (model, case) run has finished. `None` or empty → no summary event.
    #[serde(default)]
    pub summary_model: Option<String>,
}

fn default_reasoning_effort() -> String {
    "high".to_string()
}

#[derive(Clone, Debug, Serialize)]
pub struct BenchmarkRecord {
    pub model: String,
    pub case_id: String,
    pub category: String,
    pub prompt: String,
    pub answer: Option<String>,
    pub reasoning: Option<String>,
    pub reasoning_details: Value,
    pub usage: Value,
    pub latency_ms: u128,
    pub correct: Option<bool>,
    pub score: BenchmarkScore,
}

/// Compact reference to the winning run, embedded in summary events.
#[derive(Clone, Debug, Serialize)]
pub struct WinnerRef {
    pub model: String,
    pub case_id: String,
    pub score_total: f64,
    pub latency_ms: u128,
}

impl From<&BenchmarkRecord> for WinnerRef {
    fn from(record: &BenchmarkRecord) -> Self {
        Self {
            model: record.model.clone(),
            case_id: record.case_id.clone(),
            score_total: record.score.total,
            latency_ms: record.latency_ms,
        }
    }
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
    Summary {
        winner: WinnerRef,
        summary_model: String,
        /// Short headline for the synthesis. Empty when the model omitted it.
        title: String,
        summary: String,
        insights: Vec<String>,
        /// Suggested direction for a follow-up question. Empty when omitted.
        next_step: String,
        parsed: bool,
        raw: RunResult,
    },
    SummaryError {
        winner: WinnerRef,
        summary_model: String,
        error: String,
    },
    Done {
        total_runs: usize,
    },
}
