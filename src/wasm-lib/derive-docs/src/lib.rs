// Copyright 2023 Oxide Computer Company

//! This package defines macro attributes associated with HTTP handlers. These
//! attributes are used both to define an HTTP API and to generate an OpenAPI
//! Spec (OAS) v3 document that describes the API.

// Clippy's style advice is definitely valuable, but not worth the trouble for
// automated enforcement.
#![allow(clippy::style)]

use convert_case::Casing;
use quote::{format_ident, quote, quote_spanned, ToTokens};
use serde::Deserialize;
use serde_tokenstream::{from_tokenstream, Error};
use syn::{
    parse::{Parse, ParseStream},
    Attribute, Signature, Visibility,
};

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
pub fn stdlib(
    attr: proc_macro::TokenStream,
    item: proc_macro::TokenStream,
) -> proc_macro::TokenStream {
    do_output(do_stdlib(attr.into(), item.into()))
}

fn do_stdlib(
    attr: proc_macro2::TokenStream,
    item: proc_macro2::TokenStream,
) -> Result<(proc_macro2::TokenStream, Vec<Error>), Error> {
    let metadata = from_tokenstream(&attr)?;
    do_stdlib_inner(metadata, attr, item)
}

fn do_output(
    res: Result<(proc_macro2::TokenStream, Vec<Error>), Error>,
) -> proc_macro::TokenStream {
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

    if ast.sig.asyncness.is_some() {
        errors.push(Error::new_spanned(
            &ast.sig.fn_token,
            "stdlib functions must not be async",
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
        errors.push(Error::new_spanned(
            &ast.sig.generics,
            "generics are not permitted for stdlib functions",
        ));
    }

    if ast.sig.variadic.is_some() {
        errors.push(Error::new_spanned(&ast.sig.variadic, "no language C here"));
    }

    let name = metadata.name;
    let name_ident = format_ident!("{}", name.to_case(convert_case::Case::UpperCamel));
    let name_str = name.to_string();

    let fn_name = &ast.sig.ident;
    let fn_name_str = fn_name.to_string().replace("inner_", "");
    let fn_name_ident = format_ident!("{}", fn_name_str);
    let _visibility = &ast.vis;

    let (summary_text, description_text) = extract_doc_from_attrs(&ast.attrs);
    let comment_text = {
        let mut buf = String::new();
        buf.push_str("Std lib function: ");
        buf.push_str(&name_str);
        if let Some(s) = &summary_text {
            buf.push_str("\n");
            buf.push_str(&s);
        }
        if let Some(s) = &description_text {
            buf.push_str("\n");
            buf.push_str(&s);
        }
        buf
    };
    let description_doc_comment = quote! {
        #[doc = #comment_text]
    };

    let summary = if let Some(summary) = summary_text {
        quote! { #summary }
    } else {
        quote! { "" }
    };
    let description = if let Some(description) = description_text {
        quote! { #description }
    } else {
        quote! { "" }
    };

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
        };

        let ty = match arg {
            syn::FnArg::Receiver(pat) => pat.ty.as_ref().into_token_stream(),
            syn::FnArg::Typed(pat) => pat.ty.as_ref().into_token_stream(),
        };

        let ty_string = ty
            .to_string()
            .replace('&', "")
            .replace("mut", "")
            .replace(' ', "");
        let ty_string = ty_string.trim().to_string();
        let ty_ident = if ty_string.starts_with("Vec<") {
            let ty_string = ty_string.trim_start_matches("Vec<").trim_end_matches('>');
            let ty_ident = format_ident!("{}", ty_string);
            quote! {
               Vec<#ty_ident>
            }
        } else {
            let ty_ident = format_ident!("{}", ty_string);
            quote! {
               #ty_ident
            }
        };

        let ty_string = clean_type(&ty_string);

        if ty_string != "Args" {
            let schema = if ty_string.starts_with("Vec<") {
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
                    description: "".to_string(),
                    schema: #schema,
                    required: true,
                }
            });
        }
    }

    let ret_ty = ast.sig.output.clone();
    let ret_ty_string = ret_ty
        .into_token_stream()
        .to_string()
        .replace("-> ", "")
        .replace("Result < ", "")
        .replace(", KclError >", "");
    let ret_ty_string = ret_ty_string.trim().to_string();
    let ret_ty_ident = format_ident!("{}", ret_ty_string);
    let ret_ty_string = clean_type(&ret_ty_string);
    let return_type = quote! {
        #docs_crate::StdLibFnArg {
            name: "".to_string(),
            type_: #ret_ty_string.to_string(),
            description: "".to_string(),
            schema: #ret_ty_ident::json_schema(&mut generator),
            required: true,
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

    // The final TokenStream returned will have a few components that reference
    // `#name_ident`, the name of the function to which this macro was applied...
    let stream = quote! {
        // ... a struct type called `#name_ident` that has no members
        #[allow(non_camel_case_types, missing_docs)]
        #description_doc_comment
        pub(crate) struct #name_ident {}
        // ... a constant of type `#name` whose identifier is also #name_ident
        #[allow(non_upper_case_globals, missing_docs)]
        #description_doc_comment
        #const_struct

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

            fn args(&self) -> Vec<#docs_crate::StdLibFnArg> {
                let mut settings = schemars::gen::SchemaSettings::openapi3();
                settings.inline_subschemas = true;
                let mut generator = schemars::gen::SchemaGenerator::new(settings);

                vec![#(#arg_types),*]
            }

            fn return_value(&self) -> #docs_crate::StdLibFnArg {
                let mut settings = schemars::gen::SchemaSettings::openapi3();
                settings.inline_subschemas = true;
                let mut generator = schemars::gen::SchemaGenerator::new(settings);

                #return_type
            }

            fn unpublished(&self) -> bool {
                #unpublished
            }

            fn deprecated(&self) -> bool {
                #deprecated
            }

            fn std_lib_fn(&self) -> crate::std::StdFn {
                #fn_name_ident
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

fn extract_doc_from_attrs(attrs: &[syn::Attribute]) -> (Option<String>, Option<String>) {
    let doc = syn::Ident::new("doc", proc_macro2::Span::call_site());

    let mut lines = attrs.iter().flat_map(|attr| {
        if let syn::Meta::NameValue(nv) = &attr.meta {
            if nv.path.is_ident(&doc) {
                if let syn::Expr::Lit(syn::ExprLit {
                    lit: syn::Lit::Str(s),
                    ..
                }) = &nv.value
                {
                    return normalize_comment_string(s.value());
                }
            }
        }
        Vec::new()
    });

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

    match (summary, first) {
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
    }
}

fn normalize_comment_string(s: String) -> Vec<String> {
    s.split('\n')
        .enumerate()
        .map(|(idx, s)| {
            // Rust-style comments are intrinsically single-line. We don't want
            // to trim away formatting such as an initial '*'.
            if idx == 0 {
                s.trim_start().trim_end()
            } else {
                let trimmed = s.trim_start().trim_end();
                trimmed
                    .strip_prefix("* ")
                    .unwrap_or_else(|| trimmed.strip_prefix('*').unwrap_or(trimmed))
            }
        })
        .map(ToString::to_string)
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

fn clean_type(t: &str) -> String {
    if t == "f64" {
        return "number".to_string();
    } else if t == "str" {
        return "string".to_string();
    } else {
        return t.to_string();
    }
}

#[cfg(test)]
mod tests {

    use quote::quote;

    use super::*;

    #[test]
    fn test_stdlib_line_to() {
        let (item, errors) = do_stdlib(
            quote! {
                name = "lineTo",
            },
            quote! {
                fn inner_line_to(
                    data: LineToData,
                    sketch_group: SketchGroup,
                    args: &Args,
                ) -> Result<SketchGroup, KclError> {
                    Ok(())
                }
            },
        )
        .unwrap();
        let _expected = quote! {};

        assert!(errors.is_empty());
        expectorate::assert_contents(
            "tests/lineTo.gen",
            &openapitor::types::get_text_fmt(&item).unwrap(),
        );
    }

    #[test]
    fn test_stdlib_min() {
        let (item, errors) = do_stdlib(
            quote! {
                name = "min",
            },
            quote! {
                fn inner_min(
                    /// The args to do shit to.
                    args: Vec<f64>
                ) -> f64 {
                    let mut min = std::f64::MAX;
                    for arg in args.iter() {
                        if *arg < min {
                            min = *arg;
                        }
                    }

                     min
                }
            },
        )
        .unwrap();
        let _expected = quote! {};

        assert!(errors.is_empty());
        expectorate::assert_contents(
            "tests/min.gen",
            &openapitor::types::get_text_fmt(&item).unwrap(),
        );
    }
}
