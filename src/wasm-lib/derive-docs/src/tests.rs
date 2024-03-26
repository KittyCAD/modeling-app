use anyhow::Result;
use quote::quote;

use crate::{do_stdlib, parse_array_type};

fn clean_text(s: &str) -> String {
    // Add newlines after end-braces at <= two levels of indentation.
    if cfg!(not(windows)) {
        let regex = regex::Regex::new(r"(})(\n\s{0,8}[^} ])").unwrap();
        regex.replace_all(s, "$1\n$2").to_string()
    } else {
        let regex = regex::Regex::new(r"(})(\r\n\s{0,8}[^} ])").unwrap();
        regex.replace_all(s, "$1\r\n$2").to_string()
    }
}

/// Format a TokenStream as a string and run `rustfmt` on the result.
fn get_text_fmt(output: &proc_macro2::TokenStream) -> Result<String> {
    // Format the file with rustfmt.
    let content = rustfmt_wrapper::rustfmt(output).unwrap();

    Ok(clean_text(&content))
}

#[test]
fn test_get_inner_array_type() {
    for (expected, input) in [
        (Some(("f64", 2)), "[f64;2]"),
        (Some(("String", 2)), "[String; 2]"),
        (Some(("Option<String>", 12)), "[Option<String>;12]"),
        (Some(("Option<String>", 12)), "[Option<String>; 12]"),
    ] {
        let actual = parse_array_type(input);
        assert_eq!(actual, expected);
    }
}

#[test]
fn test_stdlib_line_to() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "lineTo",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     lineTo
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
            /// lineTo
            /// ```
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
    expectorate::assert_contents("tests/lineTo.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_min() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "min",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     min
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
            /// min
            /// ```
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
    expectorate::assert_contents("tests/min.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_show() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     show
            fn inner_show(
                /// The args to do shit to.
                _args: Vec<f64>
            ) {
            }
        },
    )
    .unwrap();
    let _expected = quote! {};

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/show.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_box() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     show
            fn inner_show(
                /// The args to do shit to.
                args: Box<f64>
            ) -> Box<f64> {
                args
            }
        },
    )
    .unwrap();
    let _expected = quote! {};

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/box.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_option() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     show
            fn inner_show(
                /// The args to do shit to.
                args: Option<f64>
            ) -> Result<Box<f64>> {
                args
            }
        },
    )
    .unwrap();

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/option.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_array() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     show
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
            /// show
            /// ```
            fn inner_show(
                /// The args to do shit to.
                args: [f64; 2]
            ) -> Result<Box<f64>> {
                args
            }
        },
    )
    .unwrap();

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/array.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_option_input_format() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     import
            fn inner_import(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Box<f64>> {
                args
            }
        },
    )
    .unwrap();

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/option_input_format.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_return_vec_sketch_group() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     import
            fn inner_import(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Vec<SketchGroup>> {
                args
            }
        },
    )
    .unwrap();

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/return_vec_sketch_group.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_return_vec_box_sketch_group() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     import
            fn inner_import(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Vec<Box<SketchGroup>>> {
                args
            }
        },
    )
    .unwrap();

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/return_vec_box_sketch_group.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_doc_comment_with_code() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "myFunc",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     myFunc
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
            /// myFunc
            /// ```
            fn inner_my_func(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Vec<Box<SketchGroup>>> {
                args
            }
        },
    )
    .unwrap();

    assert!(errors.is_empty());
    expectorate::assert_contents("tests/doc_comment_with_code.gen", &get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_doc_comment_with_code_on_ignored_function() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///     import
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
            /// import
            /// ```
            fn inner_import(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Vec<Box<SketchGroup>>> {
                args
            }
        },
    )
    .unwrap();

    assert!(errors.is_empty());
    expectorate::assert_contents(
        "tests/doc_comment_with_code_on_ignored_function.gen",
        &get_text_fmt(&item).unwrap(),
    );
}

#[test]
fn test_stdlib_fail_non_camel_case() {
    let (_, errors) = do_stdlib(
        quote! {
            name = "import_thing",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
            /// ```
            fn inner_import_thing(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Vec<Box<SketchGroup>>> {
                args
            }
        },
    )
    .unwrap();

    assert!(!errors.is_empty());
    assert_eq!(
        errors[1].to_string(),
        "stdlib function names must be in camel case: `import_thing`"
    );
}

#[test]
fn test_stdlib_fail_no_code_block() {
    let (_, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
            fn inner_import(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Vec<Box<SketchGroup>>> {
                args
            }
        },
    )
    .unwrap();

    assert!(!errors.is_empty());
    assert_eq!(
        errors[1].to_string(),
        "stdlib functions must have at least one code block"
    );
}

#[test]
fn test_stdlib_fail_name_not_in_code_block() {
    let (_, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
            /// This is some function.
            /// It does shit.
            ///
            ///     This is code.
            ///     It does other shit.
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
            /// ```
            fn inner_import(
                /// The args to do shit to.
                args: Option<kittycad::types::InputFormat>
            ) -> Result<Vec<Box<SketchGroup>>> {
                args
            }
        },
    )
    .unwrap();

    assert!(!errors.is_empty());
    assert_eq!(
        errors[1].to_string(),
        "stdlib functions must have the function name `import` in the code block"
    );
}
