#[cfg(test)]
mod tests {
    macro_rules! parse_and_lex {
        ($func_name:ident, $test_kcl_program:expr) => {
            #[test]
            fn $func_name() {
                let _ = crate::parser::top_level_parse($test_kcl_program);
            }
        };
    }

    parse_and_lex!(crash_eof_1, "{\"ގގ\0\0\0\"\".");
    parse_and_lex!(crash_eof_2, "(/=e\"\u{616}ݝ\"\"");
}
