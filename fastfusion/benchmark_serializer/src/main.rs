mod api;
mod benchmark;
mod config;
mod error;
mod openrouter;
mod state;

use axum::Router;
use state::AppState;
use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() {
    dotenvy::dotenv().ok();

    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let config = config::Config::from_env();

    let http = reqwest::Client::new();

    let state = Arc::new(AppState { config, http });

    let app: Router = api::router(state);

    let listener = tokio::net::TcpListener::bind("0.0.0.0:8001")
        .await
        .expect("failed to bind");

    tracing::info!("gateway listening on :8001");

    axum::serve(listener, app).await.expect("server failed");
}
