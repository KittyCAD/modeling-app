use std::ffi::OsStr;
use std::ffi::OsString;
use std::path::Path;

use super::command;
use super::quote_shell_word;

#[test]
fn builds_the_complete_command() {
    let parser = ["./parser", "--flag", "it's $literal", ""].map(OsString::from);
    assert_eq!(
        command(
            Path::new("/working directory"),
            &parser,
            Path::new("corpus/failures/unexpected verdict.kcl"),
        ),
        r"(cd '/working directory' && exec -- './parser' '--flag' 'it'\''s $literal' '' < 'corpus/failures/unexpected verdict.kcl')",
    );
}

#[test]
fn escapes_control_characters_as_bytes() {
    assert_eq!(quote_shell_word(OsStr::new("\n")), r"$'\x0a'");
}

#[cfg(unix)]
#[test]
fn preserves_non_utf8_bytes() {
    use std::os::unix::ffi::OsStrExt;

    assert_eq!(quote_shell_word(OsStr::from_bytes(b"\xff")), r"$'\xff'");
}
