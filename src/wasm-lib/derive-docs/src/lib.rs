// Clippy's style advice is definitely valuable, but not worth the trouble for
// automated enforcement.
#![allow(clippy::style)]

#[cfg(test)]
mod tests;
mod unbox;

use convert_case::Casing;
use inflector::Inflector;
use once_cell::sync::Lazy;
use quote::{format_ident, quote, quote_spanned, ToTokens};
use regex::Regex;
use serde::Deserialize;
use serde_tokenstream::{from_tokenstream, Error};
use syn::{
    parse::{Parse, ParseStream},
    Attribute, Signature, Visibility,
};
use unbox::unbox;

#[derive(Deserialize, Debug)]
struct StdlibMetadata {
    /// The name of the function in the API.
    name: String,
    /// Tags for the function.
    #[serde(default)]
    tags: Vec<String>,
    /// Whether the function is unpublished.
    /// Then docs will not be generated.
    #[serde(default)]
    unpublished: bool,
    /// Whether the function is deprecated.
    /// Then specific docs detailing that this is deprecated will be generated.
    #[serde(default)]
    deprecated: bool,
}

#[proc_macro_attribute]
pub fn stdlib(attr: proc_macro::TokenStream, item: proc_macro::TokenStream) -> proc_macro::TokenStream {
    do_output(do_stdlib(attr.into(), item.into()))
}

fn do_stdlib(
    attr: proc_macro2::TokenStream,
    item: proc_macro2::TokenStream,
) -> Result<(proc_macro2::TokenStream, Vec<Error>), Error> {
    let metadata = from_tokenstream(&attr)?;
    do_stdlib_inner(metadata, attr, item)
}

fn do_output(res: Result<(proc_macro2::TokenStream, Vec<Error>), Error>) -> proc_macro::TokenStream {
    match res {
        Err(err) => err.to_compile_error().into(),
        Ok((stdlib_docs, errors)) => {
            let compiler_errors = errors.iter().map(|err| err.to_compile_error());

            let output = quote! {
                #stdlib_docs
                #( #compiler_errors )*
            };

            output.into()
        }
    }
}

fn do_stdlib_inner(
    metadata: StdlibMetadata,
    _attr: proc_macro2::TokenStream,
    item: proc_macro2::TokenStream,
) -> Result<(proc_macro2::TokenStream, Vec<Error>), Error> {
    let ast: ItemFnForSignature = syn::parse2(item.clone())?;

    let mut errors = Vec::new();

    if ast.sig.constness.is_some() {
        errors.push(Error::new_spanned(
            &ast.sig.constness,
            "stdlib functions may not be const functions",
        ));
    }

    if ast.sig.unsafety.is_some() {
        errors.push(Error::new_spanned(
            &ast.sig.unsafety,
            "stdlib functions may not be unsafe",
        ));
    }

    if ast.sig.abi.is_some() {
        errors.push(Error::new_spanned(
            &ast.sig.abi,
            "stdlib functions may not use an alternate ABI",
        ));
    }

    if !ast.sig.generics.params.is_empty() {
        if ast.sig.generics.params.iter().any(|generic_type| match generic_type {
            syn::GenericParam::Lifetime(_) => false,
            syn::GenericParam::Type(_) => true,
            syn::GenericParam::Const(_) => true,
        }) {
            errors.push(Error::new_spanned(
                &ast.sig.generics,
                "Stdlib functions may not be generic over types or constants, only lifetimes.",
            ));
        }
    }

    if ast.sig.variadic.is_some() {
        errors.push(Error::new_spanned(&ast.sig.variadic, "no language C here"));
    }

    let name = metadata.name;

    // Fail if the name is not camel case.
    let whitelist = [
        "mirror2d",
        "patternLinear3d",
        "patternLinear2d",
        "patternCircular3d",
        "patternCircular2d",
    ];
    if !name.is_camel_case() && !whitelist.contains(&name.as_str()) {
        errors.push(Error::new_spanned(
            &ast.sig.ident,
            format!("stdlib function names must be in camel case: `{}`", name),
        ));
    }

    let name_ident = format_ident!("{}", name.to_case(convert_case::Case::UpperCamel));
    let name_str = name.to_string();

    let fn_name = &ast.sig.ident;
    let fn_name_str = fn_name.to_string().replace("inner_", "");
    let fn_name_ident = format_ident!("{}", fn_name_str);
    let boxed_fn_name_ident = format_ident!("boxed_{}", fn_name_str);
    let _visibility = &ast.vis;

    let doc_info = extract_doc_from_attrs(&ast.attrs);
    let comment_text = {
        let mut buf = String::new();
        buf.push_str("Std lib function: ");
        buf.push_str(&name_str);
        if let Some(s) = &doc_info.summary {
            buf.push_str("\n");
            buf.push_str(&s);
        }
        if let Some(s) = &doc_info.description {
            buf.push_str("\n");
            buf.push_str(&s);
        }
        buf
    };
    let description_doc_comment = quote! {
        #[doc = #comment_text]
    };

    let summary = if let Some(summary) = doc_info.summary {
        quote! { #summary }
    } else {
        quote! { "" }
    };
    let description = if let Some(description) = doc_info.description {
        quote! { #description }
    } else {
        quote! { "" }
    };

    let cb = doc_info.code_blocks.clone();
    let code_blocks = if !cb.is_empty() {
        quote! {
            let code_blocks = vec![#(#cb),*];
            code_blocks.iter().map(|cb| {
                let tokens = crate::token::lexer(cb).unwrap();
                let parser = crate::parser::Parser::new(tokens);
                let program = parser.ast().unwrap();

                let mut options: crate::ast::types::FormatOptions = Default::default();
                options.insert_final_newline = false;
                program.recast(&options, 0)
            }).collect::<Vec<String>>()
        }
    } else {
        errors.push(Error::new_spanned(
            &ast.sig,
            "stdlib functions must have at least one code block",
        ));

        quote! { vec![] }
    };

    // Make sure the function name is in all the code blocks.
    for code_block in doc_info.code_blocks.iter() {
        if !code_block.contains(&name) {
            errors.push(Error::new_spanned(
                &ast.sig,
                format!(
                    "stdlib functions must have the function name `{}` in the code block",
                    name
                ),
            ));
        }
    }

    let test_code_blocks = doc_info
        .code_blocks
        .iter()
        .enumerate()
        .map(|(index, code_block)| generate_code_block_test(&fn_name_str, code_block, index))
        .collect::<Vec<_>>();

    let tags = metadata
        .tags
        .iter()
        .map(|tag| {
            quote! { #tag.to_string() }
        })
        .collect::<Vec<_>>();

    let deprecated = if metadata.deprecated {
        quote! { true }
    } else {
        quote! { false }
    };

    let unpublished = if metadata.unpublished {
        quote! { true }
    } else {
        quote! { false }
    };

    let docs_crate = get_crate(None);

    // When the user attaches this proc macro to a function with the wrong type
    // signature, the resulting errors can be deeply inscrutable. To attempt to
    // make failures easier to understand, we inject code that asserts the types
    // of the various parameters. We do this by calling dummy functions that
    // require a type that satisfies SharedExtractor or ExclusiveExtractor.
    let mut arg_types = Vec::new();
    for arg in ast.sig.inputs.iter() {
        // Get the name of the argument.
        let arg_name = match arg {
            syn::FnArg::Receiver(pat) => {
                let span = pat.self_token.span.unwrap();
                span.source_text().unwrap().to_string()
            }
            syn::FnArg::Typed(pat) => match &*pat.pat {
                syn::Pat::Ident(ident) => ident.ident.to_string(),
                _ => {
                    errors.push(Error::new_spanned(
                        &pat.pat,
                        "stdlib functions may not use destructuring patterns",
                    ));
                    continue;
                }
            },
        }
        .trim_start_matches('_')
        .to_string();

        let ty = match arg {
            syn::FnArg::Receiver(pat) => pat.ty.as_ref().into_token_stream(),
            syn::FnArg::Typed(pat) => pat.ty.as_ref().into_token_stream(),
        };

        let (ty_string, ty_ident) = clean_ty_string(ty.to_string().as_str());

        let ty_string = rust_type_to_openapi_type(&ty_string);
        let required = !ty_ident.to_string().starts_with("Option <");

        if ty_string != "ExecState" && ty_string != "Args" {
            let schema = if ty_ident.to_string().starts_with("Vec < ")
                || ty_ident.to_string().starts_with("Option <")
                || ty_ident.to_string().starts_with('[')
            {
                quote! {
                   <#ty_ident>::json_schema(&mut generator)
                }
            } else {
                quote! {
                    #ty_ident::json_schema(&mut generator)
                }
            };
            arg_types.push(quote! {
                #docs_crate::StdLibFnArg {
                    name: #arg_name.to_string(),
                    type_: #ty_string.to_string(),
                    schema: #schema,
                    schema_definitions: generator.definitions().clone(),
                    required: #required,
                }
            });
        }
    }

    let return_type_inner = match &ast.sig.output {
        syn::ReturnType::Default => quote! { () },
        syn::ReturnType::Type(_, ty) => {
            // Get the inside of the result.
            match &**ty {
                syn::Type::Path(syn::TypePath { path, .. }) => {
                    let path = &path.segments;
                    if path.len() == 1 {
                        let seg = &path[0];
                        if seg.ident == "Result" {
                            if let syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments {
                                args,
                                ..
                            }) = &seg.arguments
                            {
                                if args.len() == 2 || args.len() == 1 {
                                    let mut args = args.iter();
                                    let ok = args.next().unwrap();
                                    if let syn::GenericArgument::Type(ty) = ok {
                                        let ty = unbox(ty.clone());
                                        quote! { #ty }
                                    } else {
                                        quote! { () }
                                    }
                                } else {
                                    quote! { () }
                                }
                            } else {
                                quote! { () }
                            }
                        } else {
                            let ty = unbox(*ty.clone());
                            quote! { #ty }
                        }
                    } else {
                        quote! { () }
                    }
                }
                _ => {
                    quote! { () }
                }
            }
        }
    };

    let ret_ty_string = return_type_inner.to_string().replace(' ', "");
    let return_type = if !ret_ty_string.is_empty() || ret_ty_string != "()" {
        let ret_ty_string = rust_type_to_openapi_type(&ret_ty_string);
        quote! {
            let schema = <#return_type_inner>::json_schema(&mut generator);
            Some(#docs_crate::StdLibFnArg {
                name: "".to_string(),
                type_: #ret_ty_string.to_string(),
                schema,
                schema_definitions: generator.definitions().clone(),
                required: true,
            })
        }
    } else {
        quote! {
            None
        }
    };

    // For reasons that are not well understood unused constants that use the
    // (default) call_site() Span do not trigger the dead_code lint. Because
    // defining but not using an endpoint is likely a programming error, we
    // want to be sure to have the compiler flag this. We force this by using
    // the span from the name of the function to which this macro was applied.
    let span = ast.sig.ident.span();
    let const_struct = quote_spanned! {span=>
        pub(crate) const #name_ident: #name_ident = #name_ident {};
    };

    let test_mod_name = format_ident!("test_examples_{}", fn_name_str);

    // The final TokenStream returned will have a few components that reference
    // `#name_ident`, the name of the function to which this macro was applied...
    let stream = quote! {
        #[cfg(test)]
        mod #test_mod_name {
            #(#test_code_blocks)*
        }

        // ... a struct type called `#name_ident` that has no members
        #[allow(non_camel_case_types, missing_docs)]
        #description_doc_comment
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, schemars::JsonSchema, ts_rs::TS)]
        #[ts(export)]
        pub(crate) struct #name_ident {}
        // ... a constant of type `#name` whose identifier is also #name_ident
        #[allow(non_upper_case_globals, missing_docs)]
        #description_doc_comment
        #const_struct

        fn #boxed_fn_name_ident(
            exec_state: &mut crate::executor::ExecState,
            args: crate::std::Args,
        ) -> std::pin::Pin<
            Box<dyn std::future::Future<Output = anyhow::Result<crate::executor::KclValue, crate::errors::KclError>> + Send + '_>,
        > {
            Box::pin(#fn_name_ident(exec_state, args))
        }

        impl #docs_crate::StdLibFn for #name_ident
        {
            fn name(&self) -> String {
                #name_str.to_string()
            }

            fn summary(&self) -> String {
                #summary.to_string()
            }

            fn description(&self) -> String {
                #description.to_string()
            }

            fn tags(&self) -> Vec<String> {
                vec![#(#tags),*]
            }

            fn args(&self, inline_subschemas: bool) -> Vec<#docs_crate::StdLibFnArg> {
                let mut settings = schemars::gen::SchemaSettings::openapi3();
                // We set this to false so we can recurse them later.
                settings.inline_subschemas = inline_subschemas;
                let mut generator = schemars::gen::SchemaGenerator::new(settings);

                vec![#(#arg_types),*]
            }

            fn return_value(&self, inline_subschemas: bool) -> Option<#docs_crate::StdLibFnArg> {
                let mut settings = schemars::gen::SchemaSettings::openapi3();
                // We set this to false so we can recurse them later.
                settings.inline_subschemas = inline_subschemas;
                let mut generator = schemars::gen::SchemaGenerator::new(settings);

                #return_type
            }

            fn unpublished(&self) -> bool {
                #unpublished
            }

            fn deprecated(&self) -> bool {
                #deprecated
            }

            fn examples(&self) -> Vec<String> {
                #code_blocks
            }

            fn std_lib_fn(&self) -> crate::std::StdFn {
                #boxed_fn_name_ident
            }

            fn clone_box(&self) -> Box<dyn #docs_crate::StdLibFn> {
                Box::new(self.clone())
            }
        }

        #item
    };

    // Prepend the usage message if any errors were detected.
    if !errors.is_empty() {
        errors.insert(0, Error::new_spanned(&ast.sig, ""));
    }

    Ok((stream, errors))
}

#[allow(dead_code)]
fn to_compile_errors(errors: Vec<syn::Error>) -> proc_macro2::TokenStream {
    let compile_errors = errors.iter().map(syn::Error::to_compile_error);
    quote!(#(#compile_errors)*)
}

fn get_crate(var: Option<String>) -> proc_macro2::TokenStream {
    if let Some(s) = var {
        if let Ok(ts) = syn::parse_str(s.as_str()) {
            return ts;
        }
    }
    quote!(crate::docs)
}

#[derive(Debug)]
struct DocInfo {
    pub summary: Option<String>,
    pub description: Option<String>,
    pub code_blocks: Vec<String>,
}

fn extract_doc_from_attrs(attrs: &[syn::Attribute]) -> DocInfo {
    let doc = syn::Ident::new("doc", proc_macro2::Span::call_site());
    let mut code_blocks: Vec<String> = Vec::new();

    let raw_lines = attrs.iter().flat_map(|attr| {
        if let syn::Meta::NameValue(nv) = &attr.meta {
            if nv.path.is_ident(&doc) {
                if let syn::Expr::Lit(syn::ExprLit {
                    lit: syn::Lit::Str(s), ..
                }) = &nv.value
                {
                    return normalize_comment_string(s.value());
                }
            }
        }
        Vec::new()
    });

    // Parse any code blocks from the doc string.
    let mut code_block: Option<String> = None;
    let mut parsed_lines = Vec::new();
    for line in raw_lines {
        if line.starts_with("```") {
            if let Some(ref inner_code_block) = code_block {
                code_blocks.push(inner_code_block.trim().to_string());
                code_block = None;
            } else {
                code_block = Some(String::new());
            }

            continue;
        }
        if let Some(ref mut code_block) = code_block {
            code_block.push_str(&line);
            code_block.push('\n');
        } else {
            parsed_lines.push(line);
        }
    }

    // Parse code blocks that start with a tab or a space.
    let mut lines = Vec::new();
    for line in parsed_lines {
        if line.starts_with("    ") || line.starts_with('\t') {
            if let Some(ref mut code_block) = code_block {
                code_block.push_str(&line.trim_start_matches("    ").trim_start_matches('\t'));
                code_block.push('\n');
            } else {
                code_block = Some(format!("{}\n", line));
            }
        } else {
            if let Some(ref inner_code_block) = code_block {
                code_blocks.push(inner_code_block.trim().to_string());
                code_block = None;
            }
            lines.push(line);
        }
    }

    let mut lines = lines.into_iter();

    if let Some(code_block) = code_block {
        code_blocks.push(code_block.trim().to_string());
    }

    // Skip initial blank lines; they make for excessively terse summaries.
    let summary = loop {
        match lines.next() {
            Some(s) if s.is_empty() => (),
            next => break next,
        }
    };
    // Skip initial blank description lines.
    let first = loop {
        match lines.next() {
            Some(s) if s.is_empty() => (),
            next => break next,
        }
    };

    let (summary, description) = match (summary, first) {
        (None, _) => (None, None),
        (summary, None) => (summary, None),
        (Some(summary), Some(first)) => (
            Some(summary),
            Some(
                lines
                    .fold(first, |acc, comment| {
                        if acc.ends_with('-') || acc.ends_with('\n') || acc.is_empty() {
                            // Continuation lines and newlines.
                            format!("{}{}", acc, comment)
                        } else if comment.is_empty() {
                            // Handle fully blank comments as newlines we keep.
                            format!("{}\n", acc)
                        } else {
                            // Default to space-separating comment fragments.
                            format!("{} {}", acc, comment)
                        }
                    })
                    .trim_end()
                    .to_string(),
            ),
        ),
    };

    DocInfo {
        summary,
        description,
        code_blocks,
    }
}

fn normalize_comment_string(s: String) -> Vec<String> {
    s.split('\n')
        .enumerate()
        .map(|(idx, s)| {
            // Rust-style comments are intrinsically single-line. We don't want
            // to trim away formatting such as an initial '*'.
            // We also don't want to trim away a tab character, which is
            // used to denote a code block. Code blocks can also be denoted
            // by four spaces, but we don't want to trim those away either.
            // We only want to trim a single space character from the start of
            // a line, and only if it's the first character.
            let new = s
                .chars()
                .enumerate()
                .flat_map(|(idx, c)| {
                    if idx == 0 {
                        if c == ' ' {
                            return None;
                        }
                    }
                    Some(c)
                })
                .collect::<String>()
                .trim_end()
                .to_string();
            let s = new.as_str();

            if idx == 0 {
                s
            } else {
                s.strip_prefix("* ").unwrap_or_else(|| s.strip_prefix('*').unwrap_or(s))
            }
            .to_string()
        })
        .collect()
}

/// Represent an item without concern for its body which may (or may not)
/// contain syntax errors.
struct ItemFnForSignature {
    pub attrs: Vec<Attribute>,
    pub vis: Visibility,
    pub sig: Signature,
    pub _block: proc_macro2::TokenStream,
}

impl Parse for ItemFnForSignature {
    fn parse(input: ParseStream) -> syn::parse::Result<Self> {
        let attrs = input.call(Attribute::parse_outer)?;
        let vis: Visibility = input.parse()?;
        let sig: Signature = input.parse()?;
        let block = input.parse()?;
        Ok(ItemFnForSignature {
            attrs,
            vis,
            sig,
            _block: block,
        })
    }
}

fn clean_ty_string(t: &str) -> (String, proc_macro2::TokenStream) {
    let mut ty_string = t
        .replace("& 'a", "")
        .replace('&', "")
        .replace("mut", "")
        .replace("< 'a >", "")
        .replace(' ', "");
    if ty_string.starts_with("ExecState") {
        ty_string = "ExecState".to_string();
    }
    if ty_string.starts_with("Args") {
        ty_string = "Args".to_string();
    }
    let ty_string = ty_string.trim().to_string();
    let ty_ident = if ty_string.starts_with("Vec<") {
        let ty_string = ty_string.trim_start_matches("Vec<").trim_end_matches('>');
        let (_, ty_ident) = clean_ty_string(&ty_string);
        quote! {
           Vec<#ty_ident>
        }
    } else if ty_string.starts_with("kittycad::types::") {
        let ty_string = ty_string.trim_start_matches("kittycad::types::").trim_end_matches('>');
        let ty_ident = format_ident!("{}", ty_string);
        quote! {
           kittycad::types::#ty_ident
        }
    } else if ty_string.starts_with("Option<") {
        let ty_string = ty_string.trim_start_matches("Option<").trim_end_matches('>');
        let (_, ty_ident) = clean_ty_string(&ty_string);
        quote! {
           Option<#ty_ident>
        }
    } else if let Some((inner_array_type, num)) = parse_array_type(&ty_string) {
        let ty_string = inner_array_type.to_owned();
        let (_, ty_ident) = clean_ty_string(&ty_string);
        quote! {
           [#ty_ident; #num]
        }
    } else if ty_string.starts_with("Box<") {
        let ty_string = ty_string.trim_start_matches("Box<").trim_end_matches('>');
        let (_, ty_ident) = clean_ty_string(&ty_string);
        quote! {
           #ty_ident
        }
    } else {
        let ty_ident = format_ident!("{}", ty_string);
        quote! {
           #ty_ident
        }
    };

    (ty_string, ty_ident)
}

fn rust_type_to_openapi_type(t: &str) -> String {
    let mut t = t.to_string();
    // Turn vecs into arrays.
    // TODO: handle nested types
    if t.starts_with("Vec<") {
        t = t.replace("Vec<", "[").replace('>', "]");
    }
    if t.starts_with("Box<") {
        t = t.replace("Box<", "").replace('>', "");
    }
    if t.starts_with("Option<") {
        t = t.replace("Option<", "").replace('>', "");
    }
    if let Some((inner_type, _length)) = parse_array_type(&t) {
        t = format!("[{inner_type}]")
    }

    if t == "f64" {
        return "number".to_string();
    } else if t == "str" {
        return "string".to_string();
    } else {
        return t.replace("f64", "number").to_string();
    }
}

fn parse_array_type(type_name: &str) -> Option<(&str, usize)> {
    static RE: Lazy<Regex> = Lazy::new(|| Regex::new(r"\[([a-zA-Z0-9<>]+); ?(\d+)\]").unwrap());
    let cap = RE.captures(type_name)?;
    let inner_type = cap.get(1)?;
    let length = cap.get(2)?.as_str().parse().ok()?;
    Some((inner_type.as_str(), length))
}

// For each kcl code block, we want to generate a test that checks that the
// code block is valid kcl code and compiles and executes.
fn generate_code_block_test(fn_name: &str, code_block: &str, index: usize) -> proc_macro2::TokenStream {
    let test_name = format_ident!("kcl_test_example_{}{}", fn_name, index);
    let test_name_mock = format_ident!("test_mock_example_{}{}", fn_name, index);
    let output_test_name_str = format!("serial_test_example_{}{}", fn_name, index);

    quote! {
        #[tokio::test(flavor = "multi_thread")]
        async fn #test_name_mock() {
            let tokens = crate::token::lexer(#code_block).unwrap();
            let parser = crate::parser::Parser::new(tokens);
            let program = parser.ast().unwrap();
            let ctx = crate::executor::ExecutorContext {
                engine: std::sync::Arc::new(Box::new(crate::engine::conn_mock::EngineConnection::new().await.unwrap())),
                fs: std::sync::Arc::new(crate::fs::FileManager::new()),
                stdlib: std::sync::Arc::new(crate::std::StdLib::new()),
                settings: Default::default(),
                is_mock: true,
            };

            ctx.run(&program, None).await.unwrap();
        }

        #[tokio::test(flavor = "multi_thread", worker_threads = 5)]
        async fn #test_name() {
            let code = #code_block;
            // Note, `crate` must be kcl_lib
            let result = crate::test_server::execute_and_snapshot(code, crate::settings::types::UnitLength::Mm).await.unwrap();
            twenty_twenty::assert_image(&format!("tests/outputs/{}.png", #output_test_name_str), &result, 0.99);
        }
    }
}
