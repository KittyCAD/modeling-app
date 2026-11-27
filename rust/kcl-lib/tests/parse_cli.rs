use std::fs;
use std::io::Write;
use std::process::Command;
use std::process::Output;
use std::process::Stdio;

use kcl_lib::Program;

fn parser() -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_kcl-parse"));
    command.env_remove("ZOO_API_TOKEN").stdin(Stdio::null());
    command
}

fn parse_stdin(source: &[u8], explicit_stdin: bool) -> Output {
    let mut command = parser();
    if explicit_stdin {
        command.arg("-");
    }
    let mut child = command
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    child.stdin.take().unwrap().write_all(source).unwrap();
    child.wait_with_output().unwrap()
}

fn assert_verdict(output: &Output, verdict: &str) {
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    assert_eq!(output.stdout, format!("{verdict}\n").as_bytes(), "{output:?}");
}

fn assert_tool_error(output: &Output) {
    assert_eq!(output.status.code(), Some(2), "{output:?}");
    assert!(output.stdout.is_empty(), "{output:?}");
    assert!(!output.stderr.is_empty(), "{output:?}");
}

#[test]
fn accepts_empty_stdin() {
    let output = parse_stdin(b"", false);
    assert_verdict(&output, "accept");
    assert!(output.stderr.is_empty(), "{output:?}");
}

#[test]
fn accepts_empty_file() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("empty.kcl");
    fs::write(&path, "").unwrap();
    let output = parser().arg(path).output().unwrap();
    assert_verdict(&output, "accept");
    assert!(output.stderr.is_empty(), "{output:?}");
}

#[test]
fn accepts_whitespace_and_comments() {
    for source in [" \t\r\n", "// A comment.\n", "/* A comment. */"] {
        let output = parse_stdin(source.as_bytes(), true);
        assert_verdict(&output, "accept");
        assert!(output.stderr.is_empty(), "{output:?}");
    }
}

#[test]
fn accepts_file_with_spaces_in_path() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("valid program.kcl");
    fs::write(&path, "@settings(kclVersion = 3.0)\ntext = 'café'\n").unwrap();
    let output = parser().arg(&path).output().unwrap();
    assert_verdict(&output, "accept");
    assert!(output.stderr.is_empty(), "{output:?}");
}

#[test]
fn parses_without_resolving_imports_or_executing_calls() {
    let source = b"@settings(kclVersion = 3.0)\nimport \"missing.kcl\" as part\nx = undefinedFunction()\n";
    let output = parse_stdin(source, true);
    assert_verdict(&output, "accept");
    assert!(output.stderr.is_empty(), "{output:?}");
}

#[test]
fn accepts_warning_only_input() {
    let source = "@settings(kclVersion = 3.0)\nimport \"foo.bad\"";
    let (_, issues) = Program::parse(source).unwrap();
    assert!(issues.iter().any(|issue| issue.severity.is_warning()));
    let output = parse_stdin(source.as_bytes(), true);
    assert_verdict(&output, "accept");
    assert!(output.stderr.is_empty(), "{output:?}");
}

#[test]
fn reports_the_parser_error_on_stderr() {
    let source = "@settings(kclVersion = 3.0)\nx =";
    let error = Program::parse_no_errs(source).unwrap_err();
    let output = parse_stdin(source.as_bytes(), true);
    assert_verdict(&output, "reject");
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    assert!(diagnostic.contains(error.message()), "{diagnostic}");
    assert!(diagnostic.contains("<stdin>"), "{diagnostic}");
    assert!(diagnostic.contains("x ="), "{diagnostic}");
}

#[test]
fn reports_lexical_errors_as_rejection() {
    let source = "@settings(kclVersion = 3.0)\nx = `";
    let error = Program::parse_no_errs(source).unwrap_err();
    assert_eq!(error.error_type(), "lexical");
    let output = parse_stdin(source.as_bytes(), true);
    assert_verdict(&output, "reject");
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    assert!(diagnostic.contains(error.message()), "{diagnostic}");
}

#[test]
fn reports_file_errors_with_the_filename() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invalid.kcl");
    fs::write(&path, "@settings(kclVersion = 3.0)\nx =").unwrap();
    let output = parser().arg(&path).output().unwrap();
    assert_verdict(&output, "reject");
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    assert!(diagnostic.contains("invalid.kcl"), "{diagnostic}");
}

#[test]
fn rejects_errors_even_when_the_parser_returns_an_ast() {
    let source = "@settings(kclVersion = 3.0)\ns = sketch(on = XY) {\n  x = f(a = 1, a = 2)\n}";
    let (program, issues) = Program::parse(source).unwrap();
    assert!(program.is_some());
    assert!(issues.iter().any(|issue| issue.is_err()));
    let output = parse_stdin(source.as_bytes(), true);
    assert_verdict(&output, "reject");
    let diagnostic = String::from_utf8_lossy(&output.stderr);
    assert!(
        diagnostic.contains("You've used the parameter labelled 'a' 2 times"),
        "{diagnostic}"
    );
}

#[test]
fn rejects_trailing_invalid_input() {
    let output = parse_stdin(b"@settings(kclVersion = 3.0)\nx = 1\n)", true);
    assert_verdict(&output, "reject");
    assert!(!output.stderr.is_empty(), "{output:?}");
}

#[test]
fn distinguishes_missing_files_from_rejection() {
    let directory = tempfile::tempdir().unwrap();
    let output = parser().arg(directory.path().join("missing.kcl")).output().unwrap();
    assert_tool_error(&output);
    assert!(String::from_utf8(output.stderr).unwrap().contains("missing.kcl"));
}

#[test]
fn distinguishes_invalid_utf8_from_rejection() {
    let directory = tempfile::tempdir().unwrap();
    let path = directory.path().join("invalid-utf8.kcl");
    fs::write(&path, [0xff]).unwrap();
    assert_tool_error(&parser().arg(path).output().unwrap());
    assert_tool_error(&parse_stdin(&[0xff], true));
}

#[test]
fn rejects_invalid_arguments() {
    assert_tool_error(&parser().arg("--unknown-option").output().unwrap());
    assert_tool_error(&parser().args(["one.kcl", "two.kcl"]).output().unwrap());
}

#[test]
fn prints_help() {
    let output = parser().arg("--help").output().unwrap();
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    let help = String::from_utf8_lossy(&output.stdout);
    assert!(help.contains("kcl-parse"), "{help}");
    assert!(help.contains("FILE"), "{help}");
    assert!(output.stderr.is_empty(), "{output:?}");
}

#[test]
fn prints_version() {
    let output = parser().arg("--version").output().unwrap();
    assert_eq!(output.status.code(), Some(0), "{output:?}");
    assert_eq!(
        output.stdout,
        format!("kcl-parse {}\n", env!("CARGO_PKG_VERSION")).as_bytes()
    );
    assert!(output.stderr.is_empty(), "{output:?}");
}
