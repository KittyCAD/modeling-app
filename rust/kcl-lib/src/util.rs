use crate::errors::IsRetryable;

#[derive(Debug, Clone)]
pub struct RetryConfig {
    /// Number of retries to attempt when execution results in `EngineHangup` or
    /// `EngineInternal`.
    pub retries: usize,
    /// Whether to print a message to stderr when a retry is attempted.
    pub print_retries: bool,
}

impl Default for RetryConfig {
    fn default() -> Self {
        Self {
            retries: 2,
            print_retries: true,
        }
    }
}

/// If execution results in `EngineHangup` or `EngineInternal`, retry.
///
/// See the test variation of this: [`crate::test_util::execute_with_retries`].
pub async fn execute_with_retries<F, Fut, T, E>(config: &RetryConfig, mut execute: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: IsRetryable + std::fmt::Display,
{
    let mut retries_remaining = config.retries;
    loop {
        // Run the closure to execute.
        let exec_result = execute().await;

        if retries_remaining > 0
            && let Err(error) = &exec_result
            && error.is_retryable()
        {
            if config.print_retries {
                // Ignore the disable-println feature.
                std::eprintln!("Execute got {error}; retrying...");
            }
            retries_remaining -= 1;
            continue;
        }

        return exec_result;
    }
}
