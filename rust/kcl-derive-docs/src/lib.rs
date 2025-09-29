// Clippy's style advice is definitely valuable, but not worth the trouble for
// automated enforcement.
#![allow(clippy::style)]

mod example_tests;

#[proc_macro_attribute]
pub fn for_each_example_test(_attr: proc_macro::TokenStream, item: proc_macro::TokenStream) -> proc_macro::TokenStream {
    example_tests::do_for_each_example_test(item.into()).into()
}

#[proc_macro_attribute]
pub fn for_all_example_test(_attr: proc_macro::TokenStream, item: proc_macro::TokenStream) -> proc_macro::TokenStream {
    example_tests::do_for_all_example_test(item.into()).into()
}
