use quote::quote;

use crate::{do_stdlib, parse_array_type};

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
    expectorate::assert_contents("tests/lineTo.gen", &openapitor::types::get_text_fmt(&item).unwrap());
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
    expectorate::assert_contents("tests/min.gen", &openapitor::types::get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_show() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
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
    expectorate::assert_contents("tests/show.gen", &openapitor::types::get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_box() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
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
    expectorate::assert_contents("tests/box.gen", &openapitor::types::get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_option() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
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
    expectorate::assert_contents("tests/option.gen", &openapitor::types::get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_array() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "show",
        },
        quote! {
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
    expectorate::assert_contents("tests/array.gen", &openapitor::types::get_text_fmt(&item).unwrap());
}

#[test]
fn test_stdlib_option_input_format() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
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
    expectorate::assert_contents(
        "tests/option_input_format.gen",
        &openapitor::types::get_text_fmt(&item).unwrap(),
    );
}

#[test]
fn test_stdlib_return_vec_sketch_group() {
    let (item, errors) = do_stdlib(
        quote! {
            name = "import",
        },
        quote! {
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
    expectorate::assert_contents(
        "tests/return_vec_sketch_group.gen",
        &openapitor::types::get_text_fmt(&item).unwrap(),
    );
}

#[test]
fn test_stdlib_return_vec_box_sketch_group() {
    let (item, errors) = do_stdlib(
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

    assert!(errors.is_empty());
    expectorate::assert_contents(
        "tests/return_vec_box_sketch_group.gen",
        &openapitor::types::get_text_fmt(&item).unwrap(),
    );
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
            ///
            /// ```
            /// This is another code block.
            /// yes sirrr.
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
    expectorate::assert_contents(
        "tests/doc_comment_with_code.gen",
        &openapitor::types::get_text_fmt(&item).unwrap(),
    );
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

    assert!(errors.is_empty());
    expectorate::assert_contents(
        "tests/doc_comment_with_code_on_ignored_function.gen",
        &openapitor::types::get_text_fmt(&item).unwrap(),
    );
}
