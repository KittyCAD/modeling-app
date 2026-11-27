use std::ffi::OsStr;
use std::ffi::OsString;
use std::path::Path;

#[cfg(test)]
mod tests;

pub(super) fn command(directory: &Path, parser: &[OsString], fixture: &Path) -> String {
    let invocation = parser
        .iter()
        .map(|word| quote_shell_word(word))
        .collect::<Vec<_>>()
        .join(" ");
    format!(
        "(cd {} && exec -- {invocation} < {})",
        quote_shell_word(directory.as_os_str()),
        quote_shell_word(fixture.as_os_str()),
    )
}

fn quote_shell_word(word: &OsStr) -> String {
    if let Some(text) = word.to_str()
        && !text.chars().any(char::is_control)
    {
        return format!("'{}'", text.replace('\'', "'\\''"));
    }

    // Byte escapes preserve native Unix arguments and keep control characters out of the command.
    let escaped: String = word
        .as_encoded_bytes()
        .iter()
        .map(|byte| format!("\\x{byte:02x}"))
        .collect();
    format!("$'{escaped}'")
}
