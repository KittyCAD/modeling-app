use proc_macro::TokenStream;
use quote::{format_ident, quote};
use std::fs;
use syn::{parse_macro_input, LitStr};

/// A macro that generates test functions for each directory within a given path.
///
/// # Example
///
/// ```rust
/// #[test_all_dirs("./test_data")]
/// fn test_directory(dir_name: &str, dir_path: &Path) {
///     // Your test logic here, will be executed once for each directory
///     assert!(dir_path.is_dir());
///     println!("Testing directory: {}", dir_name);
/// }
/// ```
#[proc_macro_attribute]
pub fn test_all_dirs(attr: TokenStream, item: TokenStream) -> TokenStream {
    // Parse the path from the attribute
    // Clone attr to avoid the move issue
    let attr_clone = attr.clone();
    let path = parse_macro_input!(attr as LitStr).value();
    let path = std::path::Path::new(&path);
    let path = std::env::current_dir().unwrap().join(path);

    // Parse the function definition
    let input_fn = parse_macro_input!(item as syn::ItemFn);
    let fn_name = &input_fn.sig.ident;
    let fn_block = &input_fn.block;

    // Get all directories at the specified path
    let dirs = match get_all_directories(&path) {
        Ok(dirs) => dirs,
        Err(e) => {
            return syn::Error::new_spanned(
                proc_macro2::TokenStream::from(attr_clone),
                format!("Failed to read directories `{}`: {}", path.display(), e),
            )
            .to_compile_error()
            .into();
        }
    };

    // Generate a test function for each directory
    let test_fns = dirs.iter().map(|(dir_name, dir_path)| {
        let test_fn_name = format_ident!("{}_{}", fn_name, sanitize_dir_name(dir_name));
        let dir_name_str = dir_name.clone();
        let dir_path_str = dir_path.clone();

        quote! {
            #[tokio::test(flavor = "multi_thread")]
            async fn #test_fn_name() {
                let dir_name = #dir_name_str;
                let dir_path = std::path::Path::new(#dir_path_str);
                #fn_block
            }
        }
    });

    // Combine the generated test functions
    let expanded = quote! {
        #(#test_fns)*
    };

    TokenStream::from(expanded)
}

const IGNORE_DIRS: [&str; 2] = ["step", "screenshots"];

/// Get all directories at the specified path
fn get_all_directories(path: &std::path::Path) -> Result<Vec<(String, String)>, std::io::Error> {
    let mut dirs = Vec::new();

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let path = entry.path();

        if path.is_dir() && !IGNORE_DIRS.contains(&path.file_name().and_then(|name| name.to_str()).unwrap_or("")) {
            let dir_name = path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();

            let dir_path = path.to_str().unwrap_or("unknown").to_string();

            dirs.push((dir_name, dir_path));
        }
    }

    Ok(dirs)
}

/// Sanitize directory name to create a valid Rust identifier
fn sanitize_dir_name(name: &str) -> String {
    let name = name.replace(|c: char| !c.is_alphanumeric() && c != '_', "_");
    if name.chars().next().is_some_and(|c| c.is_numeric()) {
        format!("d_{}", name)
    } else {
        name
    }
}
