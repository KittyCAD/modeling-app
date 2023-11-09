use databake::*;
use proc_macro::TokenStream;
use quote::quote;
use syn::{parse_macro_input, LitStr};

/// Parses KCL into its AST at compile-time.
/// This macro takes exactly one argument: A string literal containing KCL.
/// # Examples
/// ```
/// extern crate alloc;
/// use kcl_compile_macro::parse_kcl;
/// let ast: kcl_lib::ast::types::Program = parse_kcl!("const y = 4");
/// ```
#[proc_macro]
pub fn parse_kcl(input: TokenStream) -> TokenStream {
    let input = parse_macro_input!(input as LitStr);
    let kcl_src = input.value();
    let tokens = kcl_lib::token::lexer(&kcl_src);
    let ast = kcl_lib::parser::Parser::new(tokens).ast().unwrap();
    let ast_struct = ast.bake(&Default::default());
    quote!(#ast_struct).into()
}
