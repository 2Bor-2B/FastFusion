#[derive(Clone)]
pub struct Config {
    pub openrouter_api_key: String,
    pub openrouter_base_url: String,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            openrouter_api_key: std::env::var("OPENROUTER_API_KEY")
                .expect("OPENROUTER_API_KEY missing"),

            openrouter_base_url: std::env::var("OPENROUTER_BASE_URL")
                .unwrap_or_else(|_| "https://openrouter.ai/api/v1".into()),
        }
    }
}
