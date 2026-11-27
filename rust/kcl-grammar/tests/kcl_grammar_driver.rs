#![cfg(unix)]

use std::ffi::OsString;
use std::fs;
use std::os::unix::ffi::OsStringExt;
use std::os::unix::fs::PermissionsExt;
use std::path::Path;
use std::process::Command;
use std::process::Output;

use serde_json::Value;
use serde_json::json;

fn corpus(root: &Path) {
    fs::create_dir_all(root.join("success")).unwrap();
    fs::create_dir_all(root.join("failures")).unwrap();
}

fn driver(root: &Path) -> Command {
    // Nextest sets the runtime path to the extracted executable when reusing an archive.
    let executable = std::env::var_os("NEXTEST_BIN_EXE_kcl_grammar_driver")
        .unwrap_or_else(|| env!("CARGO_BIN_EXE_kcl-grammar-driver").into());
    let mut command = Command::new(executable);
    command.arg("--corpus").arg(root);
    command
}

fn stdout(output: &Output) -> &str {
    std::str::from_utf8(&output.stdout).unwrap()
}

fn stderr(output: &Output) -> &str {
    std::str::from_utf8(&output.stderr).unwrap()
}

#[test]
fn checks_nested_fixtures_in_path_order() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    corpus(root);
    fs::create_dir(root.join("success/nested")).unwrap();
    fs::write(root.join("success/nested/z.kcl"), "valid").unwrap();
    fs::write(root.join("success/a.kcl"), "").unwrap();
    fs::write(root.join("success/notes.txt"), "ignore this file").unwrap();
    fs::write(root.join("failures/b.kcl"), "invalid").unwrap();
    let output = driver(root)
        .args([
            "--",
            "sh",
            "-c",
            r#"case "$(cat)" in
                ''|valid) printf 'accept\n';;
                invalid) printf 'reject\n'; printf 'syntax error\n' >&2;;
                *) exit 2;;
            esac"#,
        ])
        .output()
        .unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(
        stdout(&output),
        concat!(
            "outcome\texpected\tactual\tpath\n",
            "success\treject\treject\tfailures/b.kcl\n",
            "success\taccept\taccept\tsuccess/a.kcl\n",
            "success\taccept\taccept\tsuccess/nested/z.kcl\n",
            "Summary: 3 success, 0 fail (0 tool errors), 0 skipped\n",
        )
    );
    assert_eq!(stderr(&output), "failures/b.kcl:\nsyntax error\n");
}

#[test]
fn preserves_input_bytes_and_argument_boundaries() {
    let temporary = tempfile::tempdir().unwrap();
    corpus(temporary.path());
    let fixture = temporary.path().join("success/a file.kcl");
    fs::write(&fixture, b"\xFF\x00\r\n").unwrap();
    let output = driver(temporary.path())
        .args([
            "--",
            "sh",
            "-c",
            r#"test "$1" = '--skip-file' && cmp -s - "$2" && printf 'accept\n'"#,
            "parser",
            "--skip-file",
        ])
        .arg(&fixture)
        .output()
        .unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    assert!(stdout(&output).contains("success\taccept\taccept\tsuccess/a file.kcl\n"));
}

#[test]
fn applies_skip_patterns_relative_to_the_corpus() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path().join("corpus");
    corpus(&root);
    fs::create_dir(root.join("success/excluded")).unwrap();
    fs::write(root.join("failures/excluded.skip.kcl"), "do not parse").unwrap();
    fs::write(root.join("success/excluded/keep.kcl"), "do not parse").unwrap();
    fs::write(root.join("success/keep.skip.kcl"), "valid").unwrap();
    fs::write(
        temporary.path().join("skip patterns"),
        "/success/excluded/\n!/success/excluded/keep.kcl\n*.skip.kcl\n!/success/keep.skip.kcl\n",
    )
    .unwrap();
    let output = driver(Path::new("corpus"))
        .current_dir(temporary.path())
        .args([
            "--skip-file",
            "skip patterns",
            "--failed-files",
            "failed.txt",
            "--",
            "sh",
            "-c",
            r#"test "$(cat)" = 'valid' && printf 'accept\n'"#,
        ])
        .output()
        .unwrap();

    assert!(output.status.success(), "{}", stderr(&output));
    assert_eq!(
        stdout(&output),
        concat!(
            "outcome\texpected\tactual\tpath\n",
            "skipped\treject\t-\tfailures/excluded.skip.kcl\n",
            "skipped\taccept\t-\tsuccess/excluded/keep.kcl\n",
            "success\taccept\taccept\tsuccess/keep.skip.kcl\n",
            "Summary: 1 success, 0 fail (0 tool errors), 2 skipped\n",
        )
    );
    assert!(fs::read(temporary.path().join("failed.txt")).unwrap().is_empty());
}

#[test]
fn reports_unexpected_verdicts_with_exit_status_one() {
    let temporary = tempfile::tempdir().unwrap();
    corpus(temporary.path());
    fs::write(temporary.path().join("failures/b.kcl"), "").unwrap();
    let output = driver(temporary.path())
        .args(["--", "sh", "-c", "printf 'accept\\n'"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    assert!(stdout(&output).contains("fail\treject\taccept\tfailures/b.kcl\n"));
    assert!(stdout(&output).contains("Summary: 0 success, 1 fail (0 tool errors), 0 skipped\n"));
}

#[test]
fn reports_tool_errors_and_writes_all_failed_paths() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    corpus(root);
    fs::write(root.join("failures/a.kcl"), "unexpected").unwrap();
    fs::write(root.join("failures/b.kcl"), "exit").unwrap();
    fs::write(root.join("success/c.kcl"), "malformed").unwrap();
    let failed_files = root.join("failed.txt");
    fs::write(&failed_files, "previous run\n").unwrap();
    let output = driver(root)
        .arg("--failed-files")
        .arg(&failed_files)
        .args([
            "--",
            "sh",
            "-c",
            r#"case "$(cat)" in
                unexpected) printf 'accept\n';;
                exit) printf 'reject\n'; printf 'parser crashed' >&2; exit 2;;
                malformed) printf 'accept\nreject\n';;
            esac"#,
        ])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert_eq!(
        stdout(&output),
        concat!(
            "outcome\texpected\tactual\tpath\n",
            "fail\treject\taccept\tfailures/a.kcl\n",
            "fail\treject\t-\tfailures/b.kcl\n",
            "fail\taccept\t-\tsuccess/c.kcl\n",
            "Summary: 0 success, 3 fail (2 tool errors), 0 skipped\n",
        )
    );
    assert!(stderr(&output).contains("failures/b.kcl: parser returned exit status: 2\n"));
    assert!(stderr(&output).contains("failures/b.kcl:\nparser crashed\n"));
    assert!(stderr(&output).contains("success/c.kcl: parser stdout must contain one"));
    assert_eq!(
        fs::read_to_string(failed_files).unwrap(),
        "failures/a.kcl\nfailures/b.kcl\nsuccess/c.kcl\n"
    );
}

#[test]
fn missing_parser_is_a_tool_error() {
    let temporary = tempfile::tempdir().unwrap();
    corpus(temporary.path());
    fs::write(temporary.path().join("success/a.kcl"), "").unwrap();
    let output = driver(temporary.path())
        .arg("--")
        .arg(temporary.path().join("missing-parser"))
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert!(stdout(&output).contains("fail\taccept\t-\tsuccess/a.kcl\n"));
    assert!(stderr(&output).contains("success/a.kcl: could not run parser"));
}

#[test]
fn missing_corpus_directory_is_a_run_error() {
    let temporary = tempfile::tempdir().unwrap();
    fs::create_dir(temporary.path().join("success")).unwrap();
    let output = driver(temporary.path()).args(["--", "sh"]).output().unwrap();

    assert_eq!(output.status.code(), Some(2));
    assert!(output.stdout.is_empty());
    assert!(stderr(&output).contains("could not walk"));
    assert!(stderr(&output).contains("failures"));
}

#[test]
fn json_failed_fixture_has_reproduce_field() {
    let temporary = tempfile::tempdir().unwrap();
    let root = temporary.path();
    corpus(root);
    let fixture = root.join("failures/unexpected verdict.kcl");
    fs::write(&fixture, "").unwrap();

    let output = driver(root)
        .args(["--json", "--", "sh", "-c", "echo accept"])
        .output()
        .unwrap();

    assert_eq!(output.status.code(), Some(1));
    let report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let failed_fixture = &report["results"][0];
    assert_eq!(failed_fixture["outcome"], "fail");
    let reproduce = failed_fixture["reproduce"]
        .as_str()
        .expect("a failed fixture must have a reproduce string");
    assert!(!reproduce.is_empty());
}

#[test]
fn json_report_captures_results_and_reproduces_failures() {
    let temporary = tempfile::tempdir().unwrap();
    let workdir = temporary.path().join("working 'directory");
    let root = workdir.join("corpus inputs");
    corpus(&root);
    let unexpected_path = "failures/a 'with spaces.kcl";
    fs::write(root.join(unexpected_path), "unexpected").unwrap();
    fs::write(root.join("failures/b.kcl"), "expected").unwrap();
    fs::write(root.join("success/c.kcl"), "error").unwrap();
    fs::write(root.join("success/d.kcl"), "skip").unwrap();
    fs::write(workdir.join("skip.txt"), "/success/d.kcl\n").unwrap();

    let text_argument = "say 'hello'; $(exit 90)";
    let byte_argument = b"\xff\n";
    fs::write(workdir.join("expected-text"), text_argument).unwrap();
    fs::write(workdir.join("expected-bytes"), byte_argument).unwrap();
    let executable = "./parser's script";
    let script = workdir.join(executable);
    fs::write(
        &script,
        r#"#!/bin/sh
[ "$#" -eq 3 ] && [ -z "$1" ] || exit 91
printf '%s' "$2" | cmp -s - expected-text || exit 92
printf '%s' "$3" | cmp -s - expected-bytes || exit 93
case "$(cat)" in
  unexpected) printf 'accept\n';;
  expected) printf 'reject\n'; printf 'syntax error: "expected"\n' >&2;;
  error) printf 'tool error\n' >&2; exit 9;;
  *) exit 94;;
esac
"#,
    )
    .unwrap();
    fs::set_permissions(&script, fs::Permissions::from_mode(0o755)).unwrap();

    let output = driver(Path::new("corpus inputs"))
        .current_dir(&workdir)
        .args([
            "--json",
            "--skip-file",
            "skip.txt",
            "--failed-files",
            "failed.txt",
            "--",
            executable,
            "",
            text_argument,
        ])
        .arg(OsString::from_vec(byte_argument.to_vec()))
        .output()
        .unwrap();
    assert_eq!(output.status.code(), Some(2));
    assert!(output.stderr.is_empty(), "{}", stderr(&output));

    let mut report: Value = serde_json::from_slice(&output.stdout).unwrap();
    let results = report["results"].as_array_mut().unwrap();
    let unexpected_command = results[0].as_object_mut().unwrap().remove("reproduce").unwrap();
    let tool_error_command = results[2].as_object_mut().unwrap().remove("reproduce").unwrap();
    assert_eq!(
        report,
        json!({
            "summary": { "success": 1, "fail": 2, "skipped": 1 },
            "results": [
                { "path": unexpected_path, "expected": "reject", "actual": "accept", "outcome": "fail" },
                {
                    "path": "failures/b.kcl",
                    "expected": "reject",
                    "actual": "reject",
                    "outcome": "success",
                    "stderr": "syntax error: \"expected\"\n"
                },
                {
                    "path": "success/c.kcl",
                    "expected": "accept",
                    "actual": null,
                    "outcome": "fail",
                    "error": "parser returned exit status: 9",
                    "stderr": "tool error\n"
                },
                { "path": "success/d.kcl", "expected": "accept", "actual": null, "outcome": "skipped" }
            ]
        }),
    );
    assert_eq!(
        fs::read_to_string(workdir.join("failed.txt")).unwrap(),
        format!("{unexpected_path}\nsuccess/c.kcl\n"),
    );

    let replay = Command::new("bash")
        .current_dir(temporary.path())
        .arg("-c")
        .arg(unexpected_command.as_str().unwrap())
        .output()
        .unwrap();
    assert!(replay.status.success(), "{}", stderr(&replay));
    assert_eq!(replay.stdout, b"accept\n");

    let replay = Command::new("bash")
        .current_dir(temporary.path())
        .arg("-c")
        .arg(tool_error_command.as_str().unwrap())
        .output()
        .unwrap();
    assert_eq!(replay.status.code(), Some(9));
    assert_eq!(replay.stderr, b"tool error\n");
}
