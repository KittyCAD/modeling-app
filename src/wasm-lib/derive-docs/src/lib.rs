// Copyright 2023 Oxide Computer Company

//! This package defines macro attributes associated with HTTP handlers. These
//! attributes are used both to define an HTTP API and to generate an OpenAPI
//! Spec (OAS) v3 document that describes the API.

// Clippy's style advice is definitely valuable, but not worth the trouble for
// automated enforcement.
#![allow(clippy::style)]

use quote::format_ident;
use quote::quote;
use quote::{quote_spanned, ToTokens};
use serde::Deserialize;
use serde_tokenstream::from_tokenstream;
use serde_tokenstream::Error;
use std::ops::DerefMut;
use syn::{
    parse::{Parse, ParseStream},
    spanned::Spanned,
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
    attr: proc_macro2::TokenStream,
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

    let name = &ast.sig.ident;
    let name_str = name.to_string();
    let visibility = &ast.vis;

    let (summary_text, description_text) = extract_doc_from_attrs(&ast.attrs);
    let comment_text = {
        let mut buf = String::new();
        buf.push_str("API Endpoint: ");
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

    let summary = summary_text.map(|summary| {
        quote! { .summary(#summary) }
    });
    let description = description_text.map(|description| {
        quote! { .description(#description) }
    });

    let tags = metadata
        .tags
        .iter()
        .map(|tag| {
            quote! { .tag(#tag) }
        })
        .collect::<Vec<_>>();

    let deprecated = if metadata.deprecated {
        quote! { true }
    } else {
        quote! { false }
    };

    let unpublished = metadata.unpublished {
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
    let mut arg_is_receiver = false;
    ast.sig.inputs.iter().map(|arg| {
        match arg {
            syn::FnArg::Receiver(_) => {
                // The compiler failure here is already comprehensible.
                arg_is_receiver = true;
            }
            syn::FnArg::Typed(pat) => {
                let span = pat.ty.span();
                let ty = pat.ty.as_ref().into_token_stream();
                arg_types.push(ty.clone());
            }
        }
    });

    println!("arg_types: {:?}", arg_types);

    let arg_names = (0..arg_types.len())
        .map(|i| {
            let argname = format_ident!("arg{}", i);
            quote! { #argname }
        })
        .collect::<Vec<_>>();

    println!("arg_names: {:?}", arg_names);

    let ret_ty = ast.sig.output;
    println!("ret_ty: {:?}", ret_ty);

    // For reasons that are not well understood unused constants that use the
    // (default) call_site() Span do not trigger the dead_code lint. Because
    // defining but not using an endpoint is likely a programming error, we
    // want to be sure to have the compiler flag this. We force this by using
    // the span from the name of the function to which this macro was applied.
    let span = ast.sig.ident.span();
    let const_struct = quote_spanned! {span=>
        #visibility const #name: #name = #name {};
    };

    let construct = if errors.is_empty() {
        quote! {
            #docs_crate::ApiEndpoint::new(
                #name_str.to_string(),
                #name,
            )
            #summary
            #description
            #(#tags)*
            #visible
            #deprecated
        }
    } else {
        quote! {
            unreachable!()
        }
    };

    // The final TokenStream returned will have a few components that reference
    // `#name`, the name of the function to which this macro was applied...
    let stream = quote! {
        // ... a struct type called `#name` that has no members
        #[allow(non_camel_case_types, missing_docs)]
        #description_doc_comment
        #visibility struct #name {}
        // ... a constant of type `#name` whose identifier is also #name
        #[allow(non_upper_case_globals, missing_docs)]
        #description_doc_comment
        #const_struct

        impl #docs_crate::StdLibFn for #name
        {
            fn name(&self) -> String {
                #name_str.to_string()
            }

            fn summary(&self) -> String {
                #summary_text.to_string()
            }

            fn description(&self) -> String {
                #description_text.to_string()
            }

            fn tags(&self) -> Vec<String> {
                #tags
            }

            fn args(&self) -> Vec<#docs_crate::StdLibFnArg> {
                vec![#(#arg_types),*]
            }

            fn return_value(&self) -> #docs_crate::StdLibFnArg {
                #ret_ty
            }

            fn unpublished(&self) -> bool {
                #unpublished
            }

            fn deprecated(&self) -> bool {
                #deprecated
            }
        }
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
    syn::Ident::new("crate::docs", proc_macro2::Span::call_site()).to_token_stream()
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

#[cfg(test)]
mod tests {
    use quote::quote;
    use syn::{Signature, Visibility};

    use super::*;

    #[test]
    fn test_busted_function() {
        let f = quote! {
            fn foo(parameter: u32) -> u32 {
                (void) printf("%s", "no language C here!");
                return (0);
            }
        };
        let ast: ItemFnForSignature = syn::parse2(f).unwrap();

        let sig: Signature = syn::parse2(quote! {
            fn foo(parameter: u32) -> u32
        })
        .unwrap();

        assert!(ast.attrs.is_empty());
        assert_eq!(ast.vis, Visibility::Inherited);
        assert_eq!(ast.sig, sig);
    }

    #[test]
    fn test_stdlib_basic() {
        let (item, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c"
            },
            quote! {
                pub async fn handler_xyz(
                    _rqctx: RequestContext<()>,
                ) -> Result<HttpResponseOk<()>, HttpError> {
                    Ok(())
                }
            },
        )
        .unwrap();
        let expected = quote! {
            const _: fn() = || {
                struct NeedRequestContext(<RequestContext<()> as dropshot::RequestContextArgument>::Context) ;
            };
            const _: fn() = || {
                trait ResultTrait {
                    type T;
                    type E;
                }
                impl<TT, EE> ResultTrait for Result<TT, EE>
                where
                    TT: dropshot::HttpResponse,
                {
                    type T = TT;
                    type E = EE;
                }
                struct NeedHttpResponse(
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::T,
                );
                trait TypeEq {
                    type This: ?Sized;
                }
                impl<T: ?Sized> TypeEq for T {
                    type This = Self;
                }
                fn validate_result_error_type<T>()
                where
                    T: ?Sized + TypeEq<This = dropshot::HttpError>,
                {
                }
                validate_result_error_type::<
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::E,
                >();
            };

            #[allow(non_camel_case_types, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub struct handler_xyz {}

            #[allow(non_upper_case_globals, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub const handler_xyz: handler_xyz = handler_xyz {};

            impl From<handler_xyz>
                for dropshot::ApiEndpoint<
                    <RequestContext<()>
                as dropshot::RequestContextArgument>::Context>
            {
                fn from(_: handler_xyz) -> Self {
                    #[allow(clippy::unused_async)]
                    pub async fn handler_xyz(
                        _rqctx: RequestContext<()>,
                    ) -> Result<HttpResponseOk<()>, HttpError> {
                        Ok(())
                    }

                    const _: fn() = || {
                        fn future_stdlib_must_be_send<T: ::std::marker::Send>(_t: T) {}
                        fn check_future_bounds(arg0: RequestContext<()>) {
                            future_stdlib_must_be_send(handler_xyz(arg0));
                        }
                    };

                    dropshot::ApiEndpoint::new(
                        "handler_xyz".to_string(),
                        handler_xyz,
                        dropshot::Method::GET,
                        "application/json",
                        "/a/b/c",
                    )
                }
            }
        };

        assert!(errors.is_empty());
        assert_eq!(expected.to_string(), item.to_string());
    }

    #[test]
    fn test_stdlib_context_fully_qualified_names() {
        let (item, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c"
            },
            quote! {
                pub async fn handler_xyz(_rqctx: dropshot::RequestContext<()>) ->
                std::Result<dropshot::HttpResponseOk<()>, dropshot::HttpError>
                {
                    Ok(())
                }
            },
        )
        .unwrap();
        let expected = quote! {
            const _: fn() = || {
                struct NeedRequestContext(<dropshot::RequestContext<()> as dropshot::RequestContextArgument>::Context) ;
            };
            const _: fn() = || {
                trait ResultTrait {
                    type T;
                    type E;
                }
                impl<TT, EE> ResultTrait for Result<TT, EE>
                where
                    TT: dropshot::HttpResponse,
                {
                    type T = TT;
                    type E = EE;
                }
                struct NeedHttpResponse(
                    <std::Result<dropshot::HttpResponseOk<()>, dropshot::HttpError> as ResultTrait>::T,
                );
                trait TypeEq {
                    type This: ?Sized;
                }
                impl<T: ?Sized> TypeEq for T {
                    type This = Self;
                }
                fn validate_result_error_type<T>()
                where
                    T: ?Sized + TypeEq<This = dropshot::HttpError>,
                {
                }
                validate_result_error_type::<
                    <std::Result<dropshot::HttpResponseOk<()>, dropshot::HttpError> as ResultTrait>::E,
                >();
            };

            #[allow(non_camel_case_types, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub struct handler_xyz {}

            #[allow(non_upper_case_globals, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub const handler_xyz: handler_xyz = handler_xyz {};

            impl From<handler_xyz> for dropshot::ApiEndpoint< <dropshot::RequestContext<()> as dropshot::RequestContextArgument>::Context> {
                fn from(_: handler_xyz) -> Self {
                    #[allow(clippy::unused_async)]
                    pub async fn handler_xyz(_rqctx: dropshot::RequestContext<()>) ->
                        std::Result<dropshot::HttpResponseOk<()>, dropshot::HttpError>
                    {
                        Ok(())
                    }

                    const _: fn() = || {
                        fn future_stdlib_must_be_send<T: ::std::marker::Send>(_t: T) {}
                        fn check_future_bounds(arg0: dropshot::RequestContext<()>) {
                            future_stdlib_must_be_send(handler_xyz(arg0));
                        }
                    };

                    dropshot::ApiEndpoint::new(
                        "handler_xyz".to_string(),
                        handler_xyz,
                        dropshot::Method::GET,
                        "application/json",
                        "/a/b/c",
                    )
                }
            }
        };

        assert!(errors.is_empty());
        assert_eq!(expected.to_string(), item.to_string());
    }

    #[test]
    fn test_stdlib_with_query() {
        let (item, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c"
            },
            quote! {
                async fn handler_xyz(
                    _rqctx: RequestContext<std::i32>,
                    q: Query<Q>,
                ) -> Result<HttpResponseOk<()>, HttpError>
                {
                    Ok(())
                }
            },
        )
        .unwrap();
        let expected = quote! {
            const _: fn() = || {
                struct NeedRequestContext(<RequestContext<std::i32> as dropshot::RequestContextArgument>::Context) ;
            };
            const _: fn() = || {
                fn need_exclusive_extractor<T>()
                where
                    T: ?Sized + dropshot::ExclusiveExtractor,
                {
                }
                need_exclusive_extractor::<Query<Q> >();
            };
            const _: fn() = || {
                trait ResultTrait {
                    type T;
                    type E;
                }
                impl<TT, EE> ResultTrait for Result<TT, EE>
                where
                    TT: dropshot::HttpResponse,
                {
                    type T = TT;
                    type E = EE;
                }
                struct NeedHttpResponse(
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::T,
                );
                trait TypeEq {
                    type This: ?Sized;
                }
                impl<T: ?Sized> TypeEq for T {
                    type This = Self;
                }
                fn validate_result_error_type<T>()
                where
                    T: ?Sized + TypeEq<This = dropshot::HttpError>,
                {
                }
                validate_result_error_type::<
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::E,
                >();
            };

            #[allow(non_camel_case_types, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            struct handler_xyz {}

            #[allow(non_upper_case_globals, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            const handler_xyz: handler_xyz = handler_xyz {};

            impl From<handler_xyz>
                for dropshot::ApiEndpoint<
                    <RequestContext<std::i32> as dropshot::RequestContextArgument>::Context
                >
            {
                fn from(_: handler_xyz) -> Self {
                    #[allow(clippy::unused_async)]
                    async fn handler_xyz(
                        _rqctx: RequestContext<std::i32>,
                        q: Query<Q>,
                    ) ->
                        Result<HttpResponseOk<()>, HttpError>
                    {
                        Ok(())
                    }

                    const _: fn() = || {
                        fn future_stdlib_must_be_send<T: ::std::marker::Send>(_t: T) {}
                        fn check_future_bounds(arg0: RequestContext<std::i32>, arg1: Query<Q>) {
                            future_stdlib_must_be_send(handler_xyz(arg0, arg1));
                        }
                    };

                    dropshot::ApiEndpoint::new(
                        "handler_xyz".to_string(),
                        handler_xyz,
                        dropshot::Method::GET,
                        "application/json",
                        "/a/b/c",
                    )
                }
            }
        };

        assert!(errors.is_empty());
        assert_eq!(expected.to_string(), item.to_string());
    }

    #[test]
    fn test_stdlib_pub_crate() {
        let (item, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c"
            },
            quote! {
                pub(crate) async fn handler_xyz(
                    _rqctx: RequestContext<()>,
                    q: Query<Q>,
                ) -> Result<HttpResponseOk<()>, HttpError>
                {
                    Ok(())
                }
            },
        )
        .unwrap();
        let expected = quote! {
            const _: fn() = || {
                struct NeedRequestContext(<RequestContext<()> as dropshot::RequestContextArgument>::Context) ;
            };
            const _: fn() = || {
                fn need_exclusive_extractor<T>()
                where
                    T: ?Sized + dropshot::ExclusiveExtractor,
                {
                }
                need_exclusive_extractor::<Query<Q> >();
            };
            const _: fn() = || {
                trait ResultTrait {
                    type T;
                    type E;
                }
                impl<TT, EE> ResultTrait for Result<TT, EE>
                where
                    TT: dropshot::HttpResponse,
                {
                    type T = TT;
                    type E = EE;
                }
                struct NeedHttpResponse(
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::T,
                );
                trait TypeEq {
                    type This: ?Sized;
                }
                impl<T: ?Sized> TypeEq for T {
                    type This = Self;
                }
                fn validate_result_error_type<T>()
                where
                    T: ?Sized + TypeEq<This = dropshot::HttpError>,
                {
                }
                validate_result_error_type::<
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::E,
                >();
            };

            #[allow(non_camel_case_types, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub(crate) struct handler_xyz {}

            #[allow(non_upper_case_globals, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub(crate) const handler_xyz: handler_xyz = handler_xyz {};

            impl From<handler_xyz>
                for dropshot::ApiEndpoint<
                    <RequestContext<()> as dropshot::RequestContextArgument>::Context
                >
            {
                fn from(_: handler_xyz) -> Self {
                    #[allow(clippy::unused_async)]
                    pub(crate) async fn handler_xyz(
                        _rqctx: RequestContext<()>,
                        q: Query<Q>,
                    ) ->
                        Result<HttpResponseOk<()>, HttpError>
                    {
                        Ok(())
                    }

                    const _: fn() = || {
                        fn future_stdlib_must_be_send<T: ::std::marker::Send>(_t: T) {}
                        fn check_future_bounds(arg0: RequestContext<()>, arg1: Query<Q>) {
                            future_stdlib_must_be_send(handler_xyz(arg0, arg1));
                        }
                    };

                    dropshot::ApiEndpoint::new(
                        "handler_xyz".to_string(),
                        handler_xyz,
                        dropshot::Method::GET,
                        "application/json",
                        "/a/b/c",
                    )
                }
            }
        };

        assert!(errors.is_empty());
        assert_eq!(expected.to_string(), item.to_string());
    }

    #[test]
    fn test_stdlib_with_tags() {
        let (item, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c",
                tags = ["stuff", "things"],
            },
            quote! {
                async fn handler_xyz(
                    _rqctx: RequestContext<()>,
                ) -> Result<HttpResponseOk<()>, HttpError> {
                    Ok(())
                }
            },
        )
        .unwrap();
        let expected = quote! {
            const _: fn() = || {
                struct NeedRequestContext(<RequestContext<()> as dropshot::RequestContextArgument>::Context) ;
            };
            const _: fn() = || {
                trait ResultTrait {
                    type T;
                    type E;
                }
                impl<TT, EE> ResultTrait for Result<TT, EE>
                where
                    TT: dropshot::HttpResponse,
                {
                    type T = TT;
                    type E = EE;
                }
                struct NeedHttpResponse(
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::T,
                );
                trait TypeEq {
                    type This: ?Sized;
                }
                impl<T: ?Sized> TypeEq for T {
                    type This = Self;
                }
                fn validate_result_error_type<T>()
                where
                    T: ?Sized + TypeEq<This = dropshot::HttpError>,
                {
                }
                validate_result_error_type::<
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::E,
                >();
            };

            #[allow(non_camel_case_types, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            struct handler_xyz {}

            #[allow(non_upper_case_globals, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            const handler_xyz: handler_xyz = handler_xyz {};

            impl From<handler_xyz>
                for dropshot::ApiEndpoint<
                    <RequestContext<()>
                as dropshot::RequestContextArgument>::Context>
            {
                fn from(_: handler_xyz) -> Self {
                    #[allow(clippy::unused_async)]
                    async fn handler_xyz(
                        _rqctx: RequestContext<()>,
                    ) -> Result<HttpResponseOk<()>, HttpError> {
                        Ok(())
                    }

                    const _: fn() = || {
                        fn future_stdlib_must_be_send<T: ::std::marker::Send>(_t: T) {}
                        fn check_future_bounds(arg0: RequestContext<()>) {
                            future_stdlib_must_be_send(handler_xyz(arg0));
                        }
                    };

                    dropshot::ApiEndpoint::new(
                        "handler_xyz".to_string(),
                        handler_xyz,
                        dropshot::Method::GET,
                        "application/json",
                        "/a/b/c",
                    )
                    .tag("stuff")
                    .tag("things")
                }
            }
        };

        assert!(errors.is_empty());
        assert_eq!(expected.to_string(), item.to_string());
    }

    #[test]
    fn test_stdlib_with_doc() {
        let (item, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c"
            },
            quote! {
                /** handle "xyz" requests */
                async fn handler_xyz(
                    _rqctx: RequestContext<()>,
                ) -> Result<HttpResponseOk<()>, HttpError> {
                    Ok(())
                }
            },
        )
        .unwrap();
        let expected = quote! {
            const _: fn() = || {
                struct NeedRequestContext(<RequestContext<()> as dropshot::RequestContextArgument>::Context) ;
            };
            const _: fn() = || {
                trait ResultTrait {
                    type T;
                    type E;
                }
                impl<TT, EE> ResultTrait for Result<TT, EE>
                where
                    TT: dropshot::HttpResponse,
                {
                    type T = TT;
                    type E = EE;
                }
                struct NeedHttpResponse(
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::T,
                );
                trait TypeEq {
                    type This: ?Sized;
                }
                impl<T: ?Sized> TypeEq for T {
                    type This = Self;
                }
                fn validate_result_error_type<T>()
                where
                    T: ?Sized + TypeEq<This = dropshot::HttpError>,
                {
                }
                validate_result_error_type::<
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::E,
                >();
            };

            #[allow(non_camel_case_types, missing_docs)]
            #[doc = "API Endpoint: handler_xyz\nhandle \"xyz\" requests"]
            struct handler_xyz {}

            #[allow(non_upper_case_globals, missing_docs)]
            #[doc = "API Endpoint: handler_xyz\nhandle \"xyz\" requests"]
            const handler_xyz: handler_xyz = handler_xyz {};

            impl From<handler_xyz>
                for dropshot::ApiEndpoint<
                    <RequestContext<()>
                as dropshot::RequestContextArgument>::Context>
            {
                fn from(_: handler_xyz) -> Self {
                    #[allow(clippy::unused_async)]
                    #[doc = r#" handle "xyz" requests "#]
                    async fn handler_xyz(
                        _rqctx: RequestContext<()>,
                    ) -> Result<HttpResponseOk<()>, HttpError> {
                        Ok(())
                    }

                    const _: fn() = || {
                        fn future_stdlib_must_be_send<T: ::std::marker::Send>(_t: T) {}
                        fn check_future_bounds(arg0: RequestContext<()>) {
                            future_stdlib_must_be_send(handler_xyz(arg0));
                        }
                    };

                    dropshot::ApiEndpoint::new(
                        "handler_xyz".to_string(),
                        handler_xyz,
                        dropshot::Method::GET,
                        "application/json",
                        "/a/b/c",
                    )
                    .summary("handle \"xyz\" requests")
                }
            }
        };

        assert!(errors.is_empty());
        assert_eq!(expected.to_string(), item.to_string());
    }

    #[test]
    fn test_stdlib_invalid_item() {
        let ret = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c"
            },
            quote! {
                const POTATO = "potato";
            },
        );

        let msg = format!("{}", ret.err().unwrap());
        assert_eq!("expected `fn`", msg);
    }

    #[test]
    fn test_stdlib_bad_string() {
        let ret = do_stdlib(
            quote! {
                method = GET,
                path = /a/b/c
            },
            quote! {
                const POTATO = "potato";
            },
        );

        let msg = format!("{}", ret.err().unwrap());
        assert_eq!("expected a string, but found `/`", msg);
    }

    #[test]
    fn test_stdlib_bad_metadata() {
        let ret = do_stdlib(
            quote! {
                methud = GET,
                path = "/a/b/c"
            },
            quote! {
                const POTATO = "potato";
            },
        );

        let msg = format!("{}", ret.err().unwrap());
        assert_eq!("extraneous member `methud`", msg);
    }

    #[test]
    fn test_stdlib_not_async() {
        let (_, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c",
            },
            quote! {
                fn handler_xyz(_rqctx: RequestContext) {}
            },
        )
        .unwrap();

        assert!(!errors.is_empty());
        assert_eq!(
            errors.get(1).map(ToString::to_string),
            Some("endpoint handler functions must be async".to_string())
        );
    }

    #[test]
    fn test_stdlib_bad_context_receiver() {
        let (_, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c",
            },
            quote! {
                async fn handler_xyz(&self) {}
            },
        )
        .unwrap();

        assert!(!errors.is_empty());
        assert_eq!(
            errors.get(1).map(ToString::to_string),
            Some("Expected a non-receiver argument".to_string())
        );
    }

    #[test]
    fn test_stdlib_no_arguments() {
        let (_, errors) = do_stdlib(
            quote! {
                method = GET,
                path = "/a/b/c",
            },
            quote! {
                async fn handler_xyz() {}
            },
        )
        .unwrap();

        assert!(!errors.is_empty());
        assert_eq!(
            errors.get(1).map(ToString::to_string),
            Some("Endpoint requires arguments".to_string())
        );
    }

    #[test]
    fn test_stdlib_content_type() {
        let (item, errors) = do_stdlib(
            quote! {
                method = POST,
                path = "/a/b/c",
                content_type = "application/x-www-form-urlencoded"
            },
            quote! {
                pub async fn handler_xyz(
                    _rqctx: RequestContext<()>,
                ) -> Result<HttpResponseOk<()>, HttpError> {
                    Ok(())
                }
            },
        )
        .unwrap();

        let expected = quote! {
            const _: fn() = || {
                struct NeedRequestContext(<RequestContext<()> as dropshot::RequestContextArgument>::Context) ;
            };
            const _: fn() = || {
                trait ResultTrait {
                    type T;
                    type E;
                }
                impl<TT, EE> ResultTrait for Result<TT, EE>
                where
                    TT: dropshot::HttpResponse,
                {
                    type T = TT;
                    type E = EE;
                }
                struct NeedHttpResponse(
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::T,
                );
                trait TypeEq {
                    type This: ?Sized;
                }
                impl<T: ?Sized> TypeEq for T {
                    type This = Self;
                }
                fn validate_result_error_type<T>()
                where
                    T: ?Sized + TypeEq<This = dropshot::HttpError>,
                {
                }
                validate_result_error_type::<
                    <Result<HttpResponseOk<()>, HttpError> as ResultTrait>::E,
                >();
            };

            #[allow(non_camel_case_types, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub struct handler_xyz {}

            #[allow(non_upper_case_globals, missing_docs)]
            #[doc = "API Endpoint: handler_xyz"]
            pub const handler_xyz: handler_xyz = handler_xyz {};

            impl From<handler_xyz>
                for dropshot::ApiEndpoint<
                    <RequestContext<()>
                as dropshot::RequestContextArgument>::Context>
            {
                fn from(_: handler_xyz) -> Self {
                    #[allow(clippy::unused_async)]
                    pub async fn handler_xyz(
                        _rqctx: RequestContext<()>,
                    ) -> Result<HttpResponseOk<()>, HttpError> {
                        Ok(())
                    }

                    const _: fn() = || {
                        fn future_stdlib_must_be_send<T: ::std::marker::Send>(_t: T) {}
                        fn check_future_bounds(arg0: RequestContext<()>) {
                            future_stdlib_must_be_send(handler_xyz(arg0));
                        }
                    };

                    dropshot::ApiEndpoint::new(
                        "handler_xyz".to_string(),
                        handler_xyz,
                        dropshot::Method::POST,
                        "application/x-www-form-urlencoded",
                        "/a/b/c",
                    )
                }
            }
        };

        assert!(errors.is_empty());
        assert_eq!(expected.to_string(), item.to_string());
    }

    #[test]
    fn test_extract_summary_description() {
        /// Javadoc summary
        /// Maybe there's another name for these...
        /// ... but Java is the first place I saw these types of comments.
        #[derive(Schema)]
        struct JavadocComments;
        assert_eq!(
            extract_doc_from_attrs(&JavadocComments::schema().attrs),
            (
                Some("Javadoc summary".to_string()),
                Some(
                    "Maybe there's another name for these... ... but Java \
                    is the first place I saw these types of comments."
                        .to_string()
                )
            )
        );

        /// Javadoc summary
        ///
        /// Skip that blank.
        #[derive(Schema)]
        struct JavadocCommentsWithABlank;
        assert_eq!(
            extract_doc_from_attrs(&JavadocCommentsWithABlank::schema().attrs),
            (
                Some("Javadoc summary".to_string()),
                Some("Skip that blank.".to_string())
            )
        );

        /// Terse Javadoc summary
        #[derive(Schema)]
        struct JavadocCommentsTerse;
        assert_eq!(
            extract_doc_from_attrs(&JavadocCommentsTerse::schema().attrs),
            (Some("Terse Javadoc summary".to_string()), None)
        );

        /// Rustdoc summary
        /// Did other folks do this or what this an invention I can right-
        /// fully ascribe to Rust?
        #[derive(Schema)]
        struct RustdocComments;
        assert_eq!(
            extract_doc_from_attrs(&RustdocComments::schema().attrs),
            (
                Some("Rustdoc summary".to_string()),
                Some(
                    "Did other folks do this or what this an invention \
                    I can right-fully ascribe to Rust?"
                        .to_string()
                )
            )
        );

        /// Rustdoc summary
        ///
        /// Skip that blank.
        #[derive(Schema)]
        struct RustdocCommentsWithABlank;
        assert_eq!(
            extract_doc_from_attrs(&RustdocCommentsWithABlank::schema().attrs),
            (
                Some("Rustdoc summary".to_string()),
                Some("Skip that blank.".to_string())
            )
        );

        /// Just a Rustdoc summary
        #[derive(Schema)]
        struct JustTheRustdocSummary;
        assert_eq!(
            extract_doc_from_attrs(&JustTheRustdocSummary::schema().attrs),
            (Some("Just a Rustdoc summary".to_string()), None)
        );

        /// Just a Javadoc summary
        #[derive(Schema)]
        struct JustTheJavadocSummary;
        assert_eq!(
            extract_doc_from_attrs(&JustTheJavadocSummary::schema().attrs),
            (Some("Just a Javadoc summary".to_string()), None)
        );

        /// Summary
        /// Text
        /// More
        ///
        /// Even
        /// More
        #[derive(Schema)]
        struct SummaryDescriptionBreak;
        assert_eq!(
            extract_doc_from_attrs(&SummaryDescriptionBreak::schema().attrs),
            (
                Some("Summary".to_string()),
                Some("Text More\nEven More".to_string())
            )
        );
    }
}
