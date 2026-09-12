use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Deserialize)]
pub struct RunInput {
    pub model: String,
    pub prompt: String,

    #[serde(default = "default_effort")]
    pub reasoning_effort: String,
}

fn default_effort() -> String {
    "high".to_string()
}

#[derive(Debug, Serialize)]
pub struct ChatRequest {
    pub model: String,
    pub messages: Vec<Message>,
    pub reasoning: ReasoningConfig,
    pub provider: ProviderConfig,
}

#[derive(Debug, Serialize)]
pub struct Message {
    pub role: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
pub struct ReasoningConfig {
    pub effort: String,
    pub exclude: bool,
}

#[derive(Debug, Serialize)]
pub struct ProviderConfig {
    pub require_parameters: bool,
}

#[derive(Debug, Serialize)]
pub struct RunResult {
    pub model: String,
    pub answer: Option<String>,
    pub reasoning: Option<String>,
    pub reasoning_details: Value,
    pub usage: Value,
    pub latency_ms: u128,
}

#[derive(Debug, Deserialize)]
pub struct ChatResponse {
    pub choices: Vec<Choice>,

    #[serde(default)]
    pub usage: Value,
}

#[derive(Debug, Deserialize)]
pub struct Choice {
    pub message: ResponseMessage,
}

#[derive(Debug, Deserialize)]
pub struct ResponseMessage {
    pub content: Option<String>,

    #[serde(default)]
    pub reasoning: Option<String>,

    #[serde(default)]
    pub reasoning_details: Value,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{ChatResponse, RunInput};

    #[test]
    fn run_input_defaults_reasoning_effort() {
        let input: RunInput = serde_json::from_value(json!({
            "model": "test/model",
            "prompt": "test"
        }))
        .unwrap();

        assert_eq!(input.reasoning_effort, "high");
    }

    #[test]
    fn response_retains_arbitrary_reasoning_details() {
        let details = json!([{
            "type": "provider.future_type",
            "index": 2,
            "unknown": [1, 2, 3]
        }]);
        let response: ChatResponse = serde_json::from_value(json!({
            "choices": [{
                "message": {
                    "content": "answer",
                    "reasoning_details": details
                }
            }],
            "usage": {"tokens": 4}
        }))
        .unwrap();

        assert_eq!(response.choices[0].message.reasoning_details, details);
    }
}
