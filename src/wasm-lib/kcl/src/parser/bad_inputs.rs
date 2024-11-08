#[cfg(test)]
mod tests {

    macro_rules! parse_and_lex {
        ($func_name:ident, $test_kcl_program:expr) => {
            #[test]
            fn $func_name() {
                let module_id = $crate::parser::ModuleId::default();
                if let Ok(v) = $crate::token::lexer($test_kcl_program, module_id) {
                    let _ = $crate::parser::Parser::new(v).ast();
                }
            }
        };
    }

    parse_and_lex!(crash_eof_1, "{\"ގގ\0\0\0\"\".");
    parse_and_lex!(crash_eof_2, "(/=e\"\u{616}ݝ\"\"");
}
