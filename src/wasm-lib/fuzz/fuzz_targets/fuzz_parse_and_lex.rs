#![no_main]

use libfuzzer_sys::fuzz_target;

fuzz_target!(|data: &str| {
    if let Ok(v) = kcl_lib::token::lexer(data) {
        let _ = kcl_lib::parser::Parser::new(v).ast();
    }
});
