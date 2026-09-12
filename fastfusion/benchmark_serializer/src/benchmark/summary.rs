//! Post-benchmark synthesis: pick the winning run and ask a summary model to
//! distil it into a short summary plus reusable insights.

use std::cmp::Ordering;

use serde::Deserialize;
use serde_json::Value;

use crate::{
    benchmark::types::{BenchmarkEvent, BenchmarkRecord, WinnerRef},
    openrouter::{self, types::RunInput},
    state::AppState,
};

/// Upper bound on the reasoning text forwarded to the summary model.
const MAX_REASONING_CHARS: usize = 6000;

/// Winner rule (shared with the frontend): highest `score.total`; tie → lower
/// `latency_ms`; tie → the record that finished first (lowest index).
pub fn pick_winner(records: &[BenchmarkRecord]) -> Option<&BenchmarkRecord> {
    let mut best: Option<&BenchmarkRecord> = None;
    for record in records {
        best = Some(match best {
            None => record,
            Some(current) => match record.score.total.total_cmp(&current.score.total) {
                Ordering::Greater => record,
                Ordering::Less => current,
                Ordering::Equal if record.latency_ms < current.latency_ms => record,
                Ordering::Equal => current,
            },
        });
    }
    best
}

pub fn build_prompt(record: &BenchmarkRecord) -> String {
    let answer = record
        .answer
        .as_deref()
        .filter(|answer| !answer.is_empty())
        .unwrap_or("(empty)");
    let reasoning = record
        .reasoning
        .as_deref()
        .filter(|reasoning| !reasoning.is_empty())
        .map(|reasoning| reasoning.chars().take(MAX_REASONING_CHARS).collect::<String>())
        .unwrap_or_else(|| "(not visible)".to_string());

    format!(
        "A user asked several AI models the same question. The best-scoring answer is shown below.\n\
         Your task is to synthesize it for the user.\n\
         \n\
         Respond with ONLY a JSON object, no markdown fences, no prose, of the form:\n\
         {{\"title\": \"<6 words or fewer>\", \"summary\": \"<2-4 sentences>\", \"insights\": [\"<reusable principle>\", \"<reusable principle>\", \"<reusable principle>\"], \"next_step\": \"<one sentence naming what to explore next>\"}}\n\
         \n\
         The title is a headline for the answer, not a restatement of the question.\n\
         Write every field in the same language as the user's question.\n\
         \n\
         USER QUESTION:\n\
         {question}\n\
         \n\
         BEST ANSWER (model {model}):\n\
         {answer}\n\
         \n\
         MODEL REASONING (may be truncated):\n\
         {reasoning}\n",
        question = record.prompt,
        model = record.model,
        answer = answer,
        reasoning = reasoning,
    )
}

#[derive(Deserialize)]
struct SummaryPayload {
    #[serde(default)]
    title: String,
    summary: String,
    #[serde(default)]
    insights: Vec<Value>,
    #[serde(default)]
    next_step: String,
}

/// What the summary model produced, after parsing.
#[derive(Debug, Default, PartialEq, Eq)]
pub struct ParsedSummary {
    pub title: String,
    pub summary: String,
    pub insights: Vec<String>,
    pub next_step: String,
    /// False when the answer was not usable JSON; `summary` is then the raw text.
    pub parsed: bool,
}

/// Parses the summarizer's answer. On any failure the trimmed raw answer is
/// returned as `summary` with `parsed == false`. Never panics, whatever the input.
pub fn parse_summary(answer: &str) -> ParsedSummary {
    let trimmed = answer.trim();
    match parse_payload(trimmed) {
        Some(parsed) => parsed,
        None => ParsedSummary {
            summary: trimmed.to_string(),
            parsed: false,
            ..ParsedSummary::default()
        },
    }
}

fn parse_payload(text: &str) -> Option<ParsedSummary> {
    let body = strip_fences(text);
    let start = body.find('{')?;
    let end = body.rfind('}')?;
    if end < start {
        return None;
    }
    // `{` and `}` are single ASCII bytes, so both indices sit on char boundaries.
    let payload: SummaryPayload = serde_json::from_str(&body[start..=end]).ok()?;

    let summary = payload.summary.trim().to_string();
    if summary.is_empty() {
        return None;
    }
    let insights = payload
        .insights
        .into_iter()
        .filter_map(|value| match value {
            Value::String(insight) => {
                let insight = insight.trim();
                (!insight.is_empty()).then(|| insight.to_string())
            }
            _ => None,
        })
        .collect();
    Some(ParsedSummary {
        title: payload.title.trim().to_string(),
        summary,
        insights,
        next_step: payload.next_step.trim().to_string(),
        parsed: true,
    })
}

/// Strips a surrounding ``` / ```json fence, if present.
fn strip_fences(text: &str) -> &str {
    let mut body = text;
    if let Some(rest) = body.strip_prefix("```") {
        // Drop the remainder of the opening fence line (e.g. "json").
        body = match rest.find('\n') {
            Some(newline) => &rest[newline + 1..],
            None => rest,
        };
        body = body.trim_end();
        if let Some(inner) = body.strip_suffix("```") {
            body = inner;
        }
    }
    body.trim()
}

pub async fn summarize(
    state: &AppState,
    summary_model: &str,
    winner: &BenchmarkRecord,
) -> Result<BenchmarkEvent, String> {
    let raw = openrouter::run(
        state,
        RunInput {
            model: summary_model.to_string(),
            prompt: build_prompt(winner),
            reasoning_effort: "low".into(),
        },
    )
    .await
    .map_err(|error| error.to_string())?;

    let parsed = parse_summary(raw.answer.as_deref().unwrap_or(""));

    Ok(BenchmarkEvent::Summary {
        winner: WinnerRef::from(winner),
        summary_model: summary_model.to_string(),
        title: parsed.title,
        summary: parsed.summary,
        insights: parsed.insights,
        next_step: parsed.next_step,
        parsed: parsed.parsed,
        raw,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::benchmark::scoring::BenchmarkScore;

    fn record(model: &str, total: f64, latency_ms: u128) -> BenchmarkRecord {
        BenchmarkRecord {
            model: model.to_string(),
            case_id: "trace-1".to_string(),
            category: "user".to_string(),
            prompt: "What is 2 + 2?".to_string(),
            answer: Some("4".to_string()),
            reasoning: None,
            reasoning_details: Value::Null,
            usage: Value::Null,
            latency_ms,
            correct: None,
            score: BenchmarkScore {
                total,
                correctness_score: 0.0,
                visibility_score: 0.0,
                richness_score: 0.0,
                latency_score: 0.0,
                reasoning_visible: false,
                reasoning_chars: 0,
                has_plaintext_reasoning: false,
                has_summary_reasoning: false,
                has_encrypted_reasoning: false,
            },
        }
    }

    #[test]
    fn pick_winner_empty_is_none() {
        assert!(pick_winner(&[]).is_none());
    }

    #[test]
    fn pick_winner_prefers_highest_total() {
        let records = vec![record("a", 40.0, 100), record("b", 57.5, 900), record("c", 50.0, 10)];
        assert_eq!(pick_winner(&records).unwrap().model, "b");
    }

    #[test]
    fn pick_winner_tie_on_score_prefers_lower_latency() {
        let records = vec![record("slow", 57.5, 1500), record("fast", 57.5, 900)];
        assert_eq!(pick_winner(&records).unwrap().model, "fast");
    }

    #[test]
    fn pick_winner_full_tie_prefers_first_finished() {
        let records = vec![record("first", 57.5, 900), record("second", 57.5, 900)];
        assert_eq!(pick_winner(&records).unwrap().model, "first");
    }

    #[test]
    fn parse_summary_plain_json() {
        let parsed = parse_summary(r#"{"summary": "It adds up.", "insights": ["Check twice", "Keep it simple"]}"#);
        assert!(parsed.parsed);
        assert_eq!(parsed.summary, "It adds up.");
        assert_eq!(parsed.insights, vec!["Check twice", "Keep it simple"]);
    }

    #[test]
    fn parse_summary_fenced_json() {
        let text = "```json\n{\"summary\": \"Fenced.\", \"insights\": [\"One\"]}\n```";
        let parsed = parse_summary(text);
        assert!(parsed.parsed);
        assert_eq!(parsed.summary, "Fenced.");
        assert_eq!(parsed.insights, vec!["One"]);
    }

    #[test]
    fn parse_summary_json_after_prose() {
        let text = "Here is the JSON:\n{\"summary\": \"After prose.\", \"insights\": []}";
        let parsed = parse_summary(text);
        assert!(parsed.parsed);
        assert_eq!(parsed.summary, "After prose.");
        assert!(parsed.insights.is_empty());
    }

    #[test]
    fn parse_summary_invalid_text_falls_back() {
        let parsed = parse_summary("  just some prose, no json  ");
        assert!(!parsed.parsed);
        assert_eq!(parsed.summary, "just some prose, no json");
        assert!(parsed.insights.is_empty());
    }

    #[test]
    fn parse_summary_closing_brace_before_opening_falls_back() {
        let parsed = parse_summary("} nonsense {");
        assert!(!parsed.parsed);
        assert_eq!(parsed.summary, "} nonsense {");
        assert!(parsed.insights.is_empty());
    }

    #[test]
    fn parse_summary_skips_non_string_insights() {
        let text = r#"{"summary": "Mixed.", "insights": ["Keep", 42, null, {"x": 1}, "  ", " Trim me "]}"#;
        let parsed = parse_summary(text);
        assert!(parsed.parsed);
        assert_eq!(parsed.summary, "Mixed.");
        assert_eq!(parsed.insights, vec!["Keep", "Trim me"]);
    }

    #[test]
    fn parse_summary_empty_summary_falls_back() {
        let text = r#"{"summary": "   ", "insights": ["x"]}"#;
        let parsed = parse_summary(text);
        assert!(!parsed.parsed);
        assert_eq!(parsed.summary, text);
        assert!(parsed.insights.is_empty());
    }

    #[test]
    fn parse_summary_empty_string() {
        let parsed = parse_summary("");
        assert!(!parsed.parsed);
        assert_eq!(parsed.summary, "");
        assert!(parsed.insights.is_empty());
    }

    #[test]
    fn parse_summary_reads_title_and_next_step() {
        let parsed = parse_summary(
            r#"{"title": " A clear path ", "summary": "Do the small thing first.", "insights": ["Ship it"], "next_step": " Try one experiment. "}"#,
        );
        assert!(parsed.parsed);
        assert_eq!(parsed.title, "A clear path");
        assert_eq!(parsed.next_step, "Try one experiment.");
    }

    #[test]
    fn parse_summary_tolerates_a_missing_title_and_next_step() {
        let parsed = parse_summary(r#"{"summary": "Still fine.", "insights": []}"#);
        assert!(parsed.parsed);
        assert_eq!(parsed.title, "");
        assert_eq!(parsed.next_step, "");
        assert_eq!(parsed.summary, "Still fine.");
    }

    #[test]
    fn build_prompt_asks_for_every_field() {
        let prompt = build_prompt(&record("m", 1.0, 1));
        for field in ["\"title\"", "\"summary\"", "\"insights\"", "\"next_step\""] {
            assert!(prompt.contains(field), "prompt is missing {field}");
        }
    }

    #[test]
    fn build_prompt_includes_sections_and_placeholders() {
        let mut winner = record("nex-agi/nex-n2.5-pro:free", 57.5, 900);
        winner.answer = None;
        let prompt = build_prompt(&winner);
        assert!(prompt.contains("USER QUESTION:\nWhat is 2 + 2?"));
        assert!(prompt.contains("BEST ANSWER (model nex-agi/nex-n2.5-pro:free):\n(empty)"));
        assert!(prompt.contains("MODEL REASONING (may be truncated):\n(not visible)"));
    }

    #[test]
    fn build_prompt_truncates_reasoning_by_chars() {
        let mut winner = record("m", 1.0, 1);
        // Multi-byte chars: truncation must count chars, not bytes.
        winner.reasoning = Some("é".repeat(MAX_REASONING_CHARS + 50));
        let prompt = build_prompt(&winner);
        let reasoning = prompt
            .split("MODEL REASONING (may be truncated):\n")
            .nth(1)
            .unwrap()
            .trim_end();
        assert_eq!(reasoning.chars().count(), MAX_REASONING_CHARS);
    }

    #[test]
    fn summary_events_serialize_per_contract() {
        use crate::openrouter::types::RunResult;

        let winner = record("nex-agi/nex-n2.5-pro:free", 57.5, 1234);
        let summary = BenchmarkEvent::Summary {
            winner: WinnerRef::from(&winner),
            summary_model: "nex-agi/nex-n2.5-pro:free".to_string(),
            title: "A clear path".to_string(),
            summary: "Short.".to_string(),
            insights: vec!["A".to_string()],
            next_step: "Try one experiment.".to_string(),
            parsed: true,
            raw: RunResult {
                model: "nex-agi/nex-n2.5-pro:free".to_string(),
                answer: Some("{}".to_string()),
                reasoning: None,
                reasoning_details: Value::Null,
                usage: Value::Null,
                latency_ms: 900,
            },
        };
        let json = serde_json::to_value(&summary).unwrap();
        assert_eq!(json["type"], "summary");
        assert_eq!(json["winner"]["model"], "nex-agi/nex-n2.5-pro:free");
        assert_eq!(json["winner"]["case_id"], "trace-1");
        assert_eq!(json["winner"]["score_total"], 57.5);
        assert_eq!(json["winner"]["latency_ms"], 1234);
        assert_eq!(json["summary_model"], "nex-agi/nex-n2.5-pro:free");
        assert_eq!(json["title"], "A clear path");
        assert_eq!(json["summary"], "Short.");
        assert_eq!(json["insights"], serde_json::json!(["A"]));
        assert_eq!(json["next_step"], "Try one experiment.");
        assert_eq!(json["parsed"], true);
        assert_eq!(json["raw"]["latency_ms"], 900);
        assert!(json["raw"]["answer"].is_string());

        let failure = BenchmarkEvent::SummaryError {
            winner: WinnerRef::from(&winner),
            summary_model: "nex-agi/nex-n2.5-pro:free".to_string(),
            error: "boom".to_string(),
        };
        let json = serde_json::to_value(&failure).unwrap();
        assert_eq!(json["type"], "summary_error");
        assert_eq!(json["winner"]["score_total"], 57.5);
        assert_eq!(json["summary_model"], "nex-agi/nex-n2.5-pro:free");
        assert_eq!(json["error"], "boom");
    }
}
