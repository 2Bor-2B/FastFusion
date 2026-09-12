use serde::Serialize;
use serde_json::Value;

use crate::openrouter::types::RunResult;

#[derive(Clone, Debug, Serialize)]
pub struct BenchmarkScore {
    pub total: f64,
    pub correctness_score: f64,
    pub visibility_score: f64,
    pub richness_score: f64,
    pub latency_score: f64,
    pub reasoning_visible: bool,
    pub reasoning_chars: usize,
    pub has_plaintext_reasoning: bool,
    pub has_summary_reasoning: bool,
    pub has_encrypted_reasoning: bool,
}

#[derive(Default)]
struct ReasoningInfo {
    visible_chars: usize,
    plaintext: bool,
    summary: bool,
    encrypted: bool,
}

fn inspect_details(value: &Value, info: &mut ReasoningInfo) {
    match value {
        Value::Array(values) => values.iter().for_each(|value| inspect_details(value, info)),
        Value::Object(object) => {
            match object.get("type").and_then(Value::as_str) {
                Some("reasoning.text") => {
                    info.plaintext = true;
                    info.visible_chars += object
                        .get("text")
                        .and_then(Value::as_str)
                        .map(str::chars)
                        .map(Iterator::count)
                        .unwrap_or(0);
                }
                Some("reasoning.summary") => {
                    info.summary = true;
                    info.visible_chars += object
                        .get("summary")
                        .or_else(|| object.get("text"))
                        .and_then(Value::as_str)
                        .map(str::chars)
                        .map(Iterator::count)
                        .unwrap_or(0);
                }
                Some("reasoning.encrypted") => info.encrypted = true,
                _ => {}
            }

            object
                .values()
                .for_each(|value| inspect_details(value, info));
        }
        _ => {}
    }
}

pub fn score(run: &RunResult, correct: Option<bool>) -> BenchmarkScore {
    let mut info = ReasoningInfo::default();
    if let Some(reasoning) = run
        .reasoning
        .as_ref()
        .filter(|reasoning| !reasoning.is_empty())
    {
        info.plaintext = true;
        info.visible_chars += reasoning.chars().count();
    }
    inspect_details(&run.reasoning_details, &mut info);

    let correctness_score = if correct == Some(true) { 30.0 } else { 0.0 };
    let visibility_score = if info.plaintext {
        30.0
    } else if info.summary {
        15.0
    } else {
        0.0
    };
    let richness_score = (info.visible_chars as f64 / 3000.0).min(1.0) * 20.0;
    let latency_score = if run.latency_ms < 2_000 {
        20.0
    } else if run.latency_ms < 5_000 {
        15.0
    } else if run.latency_ms < 10_000 {
        8.0
    } else {
        0.0
    };

    BenchmarkScore {
        total: correctness_score + visibility_score + richness_score + latency_score,
        correctness_score,
        visibility_score,
        richness_score,
        latency_score,
        reasoning_visible: info.visible_chars > 0,
        reasoning_chars: info.visible_chars,
        has_plaintext_reasoning: info.plaintext,
        has_summary_reasoning: info.summary,
        has_encrypted_reasoning: info.encrypted,
    }
}
