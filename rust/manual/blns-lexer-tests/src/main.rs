use std::env;
use std::fs;
use std::panic::AssertUnwindSafe;
use std::panic::{self};
use std::path::PathBuf;
use std::process::Command;
use std::process::Stdio;
use std::process::{self};
use std::thread;
use std::time::Duration;
use std::time::Instant;

const BLNS_JSON_ENV: &str = "KCL_BLNS_JSON";
const BLNS_TIMEOUT_ENV: &str = "KCL_BLNS_TIMEOUT";
const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);
const DEFAULT_PROGRESS_EVERY: usize = 100;

fn main() {
    let args = env::args().skip(1).collect::<Vec<_>>();
    let result = if args.iter().any(|arg| arg == "--worker") {
        run_worker(&args)
    } else {
        run_parent(&args)
    };

    if let Err(error) = result {
        eprintln!("{error}");
        process::exit(1);
    }
}

fn run_parent(args: &[String]) -> Result<(), String> {
    let options = Options::parse(args)?;
    if options.help {
        println!("{}", usage());
        return Ok(());
    }

    let json_path = options.json_path.ok_or_else(usage)?;
    let current_exe = env::current_exe()
        .map_err(|error| format!("failed to locate current BLNS executable for worker mode: {error}"))?;
    let mut child = Command::new(current_exe)
        .arg("--worker")
        .arg("--json")
        .arg(&json_path)
        .arg("--progress-every")
        .arg(options.progress_every.to_string())
        .stdin(Stdio::null())
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|error| format!("failed to spawn BLNS lexer worker: {error}"))?;

    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|error| format!("failed to poll BLNS lexer worker: {error}"))?
        {
            return if status.success() {
                Ok(())
            } else {
                Err(format!("BLNS lexer worker exited with {status}"))
            };
        }

        if started.elapsed() >= options.timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(format!(
                "BLNS lexer run timed out after {}. The last progress line shows the approximate failing case.",
                format_duration(options.timeout)
            ));
        }

        thread::sleep(Duration::from_millis(20));
    }
}

fn run_worker(args: &[String]) -> Result<(), String> {
    let options = Options::parse(args)?;
    let json_path = options
        .json_path
        .ok_or_else(|| "worker missing BLNS JSON path".to_owned())?;
    let json =
        fs::read_to_string(&json_path).map_err(|error| format!("failed to read {}: {error}", json_path.display()))?;
    let cases = serde_json::from_str::<Vec<String>>(&json)
        .map_err(|error| format!("failed to parse {} as BLNS JSON: {error}", json_path.display()))?;

    eprintln!("checking {} BLNS strings from {}", cases.len(), json_path.display());
    for (index, input) in cases.iter().enumerate() {
        if should_report_progress(index, cases.len(), options.progress_every) {
            eprintln!("checking {}/{}", index + 1, cases.len());
        }

        let result = panic::catch_unwind(AssertUnwindSafe(|| check_case(index, input)));
        match result {
            Ok(Ok(())) => {}
            Ok(Err(error)) => return Err(error),
            Err(payload) => {
                let case_number = index + 1;
                return Err(format!(
                    "lexer panicked on BLNS case #{case_number}: {}\ninput: {}",
                    panic_payload(payload),
                    escaped_case(input)
                ));
            }
        }
    }

    eprintln!("checked {}/{} BLNS strings", cases.len(), cases.len());
    Ok(())
}

fn should_report_progress(index: usize, total: usize, progress_every: usize) -> bool {
    index == 0 || index + 1 == total || progress_every != 0 && (index + 1) % progress_every == 0
}

fn check_case(index: usize, input: &str) -> Result<(), String> {
    let case_number = index + 1;
    let lexed = kcl_syntax::lexer::lex(input);
    let reconstructed = lexed.iter().map(|token| token.text()).collect::<String>();
    if reconstructed != input {
        return Err(format!(
            "BLNS case #{case_number} did not round-trip\ninput: {}\noutput: {}",
            escaped_case(input),
            escaped_case(&reconstructed)
        ));
    }

    let mut offset = 0;
    for token in lexed.tokens() {
        let range = token.range();
        if range.start != offset {
            return Err(format!(
                "BLNS case #{case_number} has non-contiguous token range {range:?}; expected start {offset}\ninput: {}",
                escaped_case(input)
            ));
        }

        let token_text = input.get(range.clone()).ok_or_else(|| {
            format!(
                "BLNS case #{case_number} has invalid UTF-8 boundary range {range:?}\ninput: {}",
                escaped_case(input)
            )
        })?;
        if token_text != token.text() {
            return Err(format!(
                "BLNS case #{case_number} token text does not match its source range {range:?}\ninput: {}",
                escaped_case(input)
            ));
        }

        offset = range.end;
    }

    if offset != input.len() {
        return Err(format!(
            "BLNS case #{case_number} ended at byte {offset}, expected {}\ninput: {}",
            input.len(),
            escaped_case(input)
        ));
    }

    Ok(())
}

#[derive(Debug)]
struct Options {
    json_path: Option<PathBuf>,
    timeout: Duration,
    progress_every: usize,
    help: bool,
}

impl Options {
    fn parse(args: &[String]) -> Result<Self, String> {
        let mut json_path = env::var_os(BLNS_JSON_ENV).map(PathBuf::from);
        let mut timeout = match env::var(BLNS_TIMEOUT_ENV) {
            Ok(value) => parse_duration(&value)?,
            Err(_) => DEFAULT_TIMEOUT,
        };
        let mut progress_every = DEFAULT_PROGRESS_EVERY;
        let mut help = false;

        let mut index = 0;
        while index < args.len() {
            match args[index].as_str() {
                "--worker" => {}
                "--help" | "-h" => help = true,
                "--json" => {
                    index += 1;
                    let value = args
                        .get(index)
                        .ok_or_else(|| "--json requires a path to blns.json".to_owned())?;
                    json_path = Some(PathBuf::from(value));
                }
                "--timeout" => {
                    index += 1;
                    let value = args
                        .get(index)
                        .ok_or_else(|| "--timeout requires a duration such as 30s".to_owned())?;
                    timeout = parse_duration(value)?;
                }
                "--progress-every" => {
                    index += 1;
                    let value = args
                        .get(index)
                        .ok_or_else(|| "--progress-every requires a number".to_owned())?;
                    progress_every = value
                        .parse::<usize>()
                        .map_err(|error| format!("invalid --progress-every value {value:?}: {error}"))?;
                }
                value if value.starts_with("--json=") => {
                    json_path = Some(PathBuf::from(value.trim_start_matches("--json=")));
                }
                value if value.starts_with("--timeout=") => {
                    timeout = parse_duration(value.trim_start_matches("--timeout="))?;
                }
                value if value.starts_with("--progress-every=") => {
                    let raw = value.trim_start_matches("--progress-every=");
                    progress_every = raw
                        .parse::<usize>()
                        .map_err(|error| format!("invalid --progress-every value {raw:?}: {error}"))?;
                }
                value if value.starts_with('-') => return Err(format!("unknown option {value:?}\n\n{}", usage())),
                value => {
                    if json_path.is_some() {
                        return Err(format!("unexpected extra argument {value:?}\n\n{}", usage()));
                    }
                    json_path = Some(PathBuf::from(value));
                }
            }
            index += 1;
        }

        Ok(Self {
            json_path,
            timeout,
            progress_every,
            help,
        })
    }
}

fn parse_duration(value: &str) -> Result<Duration, String> {
    let value = value.trim();
    if value.is_empty() {
        return Err("timeout value must not be empty".to_owned());
    }

    if let Some(milliseconds) = value.strip_suffix("ms") {
        return parse_duration_number(milliseconds, value).map(Duration::from_millis);
    }

    if let Some(seconds) = value.strip_suffix('s') {
        return parse_duration_number(seconds, value).map(Duration::from_secs);
    }

    if let Some(minutes) = value.strip_suffix('m') {
        return parse_duration_number(minutes, value).map(|minutes| Duration::from_secs(minutes.saturating_mul(60)));
    }

    parse_duration_number(value, value).map(Duration::from_secs)
}

fn parse_duration_number(number: &str, original: &str) -> Result<u64, String> {
    number
        .parse::<u64>()
        .map_err(|error| format!("invalid timeout value {original:?}: {error}"))
}

fn usage() -> String {
    format!(
        "\
Manual BLNS lexer robustness runner.

Get the corpus from:
  https://github.com/minimaxir/big-list-of-naughty-strings

Usage:
  cargo run --manifest-path manual/blns-lexer-tests/Cargo.toml -- /path/to/blns.json [--timeout 30s]
  {BLNS_JSON_ENV}=/path/to/blns.json cargo run --manifest-path manual/blns-lexer-tests/Cargo.toml -- [--timeout 30s]

Options:
  --json <path>              Path to blns.json. A positional path also works.
  --timeout <duration>       Hard timeout for the worker process. Default: 30s.
  --progress-every <count>   Print progress every N cases. Default: 100. Use 0 for start/end only.

Environment:
  {BLNS_JSON_ENV}        Path to blns.json.
  {BLNS_TIMEOUT_ENV}     Timeout such as 30s, 500ms, or 5m.
"
    )
}

fn escaped_case(input: &str) -> String {
    const LIMIT: usize = 240;
    let escaped = input.escape_debug().collect::<String>();
    let mut chars = escaped.chars();
    let truncated = chars.by_ref().take(LIMIT).collect::<String>();
    if chars.next().is_some() {
        format!("{truncated}...")
    } else {
        escaped
    }
}

fn format_duration(duration: Duration) -> String {
    if duration.as_millis() % 1_000 == 0 {
        format!("{}s", duration.as_secs())
    } else {
        format!("{}ms", duration.as_millis())
    }
}

fn panic_payload(payload: Box<dyn std::any::Any + Send>) -> String {
    if let Some(message) = payload.downcast_ref::<&str>() {
        (*message).to_owned()
    } else if let Some(message) = payload.downcast_ref::<String>() {
        message.clone()
    } else {
        "non-string panic payload".to_owned()
    }
}
