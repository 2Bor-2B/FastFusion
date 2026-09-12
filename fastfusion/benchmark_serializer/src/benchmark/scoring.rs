use crate::openrouter::types::RunResult;

pub struct Score {
    pub visibility: f32,
}

pub fn score(run: &RunResult) -> Score {
    let mut value = 0.0;

    if run.reasoning.is_some() {
        value += 40.0;
    }

    if !run.reasoning_details.is_null() {
        value += 30.0;
    }

    Score { visibility: value }
}
