use std::collections::HashSet;

use serde::Serialize;
use serde_json::Value;

use crate::openrouter::types::RunResult;

#[derive(Debug, Serialize)]
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
    seen_text: HashSet<String>,
}

impl ReasoningInfo {
    fn add_plaintext(&mut self, value: Option<&str>) {
        if self.add_visible(value) {
            self.plaintext = true;
        }
    }

    fn add_summary(&mut self, value: Option<&str>) {
        if self.add_visible(value) {
            self.summary = true;
        }
    }

    fn add_visible(&mut self, value: Option<&str>) -> bool {
        let Some(text) = value.map(str::trim).filter(|text| !text.is_empty()) else {
            return false;
        };

        if self.seen_text.insert(text.to_owned()) {
            self.visible_chars += text.chars().count();
        }
        true
    }
}

fn inspect_details(value: &Value, info: &mut ReasoningInfo) {
    match value {
        Value::Array(values) => values.iter().for_each(|value| inspect_details(value, info)),
        Value::Object(object) => {
            match object.get("type").and_then(Value::as_str) {
                Some("reasoning.text") => {
                    info.add_plaintext(object.get("text").and_then(Value::as_str));
                }
                Some("reasoning.summary") => {
                    info.add_summary(
                        object
                            .get("summary")
                            .or_else(|| object.get("text"))
                            .and_then(Value::as_str),
                    );
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
    info.add_plaintext(run.reasoning.as_deref());
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

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::score;
    use crate::openrouter::types::RunResult;

    fn run(
        reasoning: Option<&str>,
        reasoning_details: serde_json::Value,
        latency_ms: u128,
    ) -> RunResult {
        RunResult {
            model: "test/model".into(),
            answer: Some("answer".into()),
            reasoning: reasoning.map(str::to_owned),
            reasoning_details,
            usage: json!({}),
            latency_ms,
        }
    }

    #[test]
    fn scores_plaintext_reasoning_and_correctness() {
        let result = run(Some("four"), json!(null), 1_999);
        let scored = score(&result, Some(true));

        assert_eq!(scored.correctness_score, 30.0);
        assert_eq!(scored.visibility_score, 30.0);
        assert_eq!(scored.latency_score, 20.0);
        assert_eq!(scored.reasoning_chars, 4);
        assert!(scored.reasoning_visible);
        assert!(scored.has_plaintext_reasoning);
    }

    #[test]
    fn finds_nested_summary_and_encrypted_telemetry() {
        let result = run(
            None,
            json!({"wrapper": [
                {"type": "reasoning.summary", "summary": "brief"},
                {"type": "reasoning.encrypted", "data": "opaque"}
            ]}),
            5_000,
        );
        let scored = score(&result, None);

        assert_eq!(scored.visibility_score, 15.0);
        assert_eq!(scored.latency_score, 8.0);
        assert_eq!(scored.reasoning_chars, 5);
        assert!(scored.has_summary_reasoning);
        assert!(scored.has_encrypted_reasoning);
        assert!(!scored.has_plaintext_reasoning);
    }

    #[test]
    fn encrypted_only_reasoning_is_not_marked_visible() {
        let result = run(
            None,
            json!([{"type": "reasoning.encrypted", "data": "opaque"}]),
            10_000,
        );
        let scored = score(&result, Some(false));

        assert_eq!(scored.total, 0.0);
        assert!(!scored.reasoning_visible);
        assert!(scored.has_encrypted_reasoning);
    }

    #[test]
    fn richness_caps_at_twenty_points() {
        let result = run(Some(&"x".repeat(4_000)), json!(null), 2_000);
        let scored = score(&result, None);

        assert_eq!(scored.richness_score, 20.0);
        assert_eq!(scored.latency_score, 15.0);
    }

    #[test]
    fn counts_unicode_characters_not_bytes() {
        let result = run(Some("a🦀é"), json!(null), 9_999);
        let scored = score(&result, None);

        assert_eq!(scored.reasoning_chars, 3);
        assert_eq!(scored.latency_score, 8.0);
    }

    #[test]
    fn rejects_whitespace_only_and_malformed_reasoning() {
        let result = run(
            Some("\n\n"),
            json!([
                {"type": "reasoning.text", "text": " \t\n"},
                {"type": "reasoning.summary", "summary": 42},
                {"type": "reasoning.text"},
                {"type": "provider.unknown", "text": "not reasoning"}
            ]),
            1_000,
        );
        let scored = score(&result, None);

        assert_eq!(scored.visibility_score, 0.0);
        assert_eq!(scored.richness_score, 0.0);
        assert_eq!(scored.reasoning_chars, 0);
        assert!(!scored.reasoning_visible);
        assert!(!scored.has_plaintext_reasoning);
        assert!(!scored.has_summary_reasoning);
    }

    #[test]
    fn trims_and_deduplicates_repeated_reasoning() {
        let result = run(
            Some("  same  "),
            json!([
                {"type": "reasoning.text", "text": "same"},
                {"type": "reasoning.summary", "summary": " same "}
            ]),
            1_000,
        );
        let scored = score(&result, None);

        assert_eq!(scored.reasoning_chars, 4);
        assert!(scored.has_plaintext_reasoning);
        assert!(scored.has_summary_reasoning);
    }
}
