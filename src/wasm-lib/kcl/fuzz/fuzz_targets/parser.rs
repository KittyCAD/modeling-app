#![no_main]
#[macro_use]
extern crate libfuzzer_sys;
extern crate kcl_lib;

fuzz_target!(|data: &[u8]| {
    if let Ok(s) = std::str::from_utf8(data) {
        let tokens = kcl_lib::tokeniser::lexer(s);
        let parser = kcl_lib::parser::Parser::new(tokens);
        if let Ok(_) = parser.ast() {
            println!("OK");
        }
    }
});
