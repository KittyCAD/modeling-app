use std::fs;

use convert_case::Casing;
use proc_macro::TokenStream;
use quote::format_ident;
use quote::quote;
use syn::Ident;
use syn::LitStr;
use syn::Token;
use syn::bracketed;
use syn::parse::Parse;
use syn::parse::ParseStream;
use syn::parse_macro_input;
use syn::punctuated::Punctuated;

struct TestAllDirsArgs {
    path: LitStr,
    exclude: Vec<String>,
}

impl Parse for TestAllDirsArgs {
    fn parse(input: ParseStream<'_>) -> syn::Result<Self> {
        let path = input.parse()?;
        let mut exclude = Vec::new();

        if !input.is_empty() {
            input.parse::<Token![,]>()?;
            let option: Ident = input.parse()?;
            if option != "exclude" {
                return Err(syn::Error::new(option.span(), "expected `exclude`"));
            }
            input.parse::<Token![=]>()?;

            let content;
            bracketed!(content in input);
            exclude = Punctuated::<LitStr, Token![,]>::parse_terminated(&content)?
                .into_iter()
                .map(|dir| dir.value())
                .collect();

            if !input.is_empty() {
                input.parse::<Token![,]>()?;
            }
        }

        Ok(Self { path, exclude })
    }
}

/// A macro that generates test functions for each directory within a given path.
/// To be included the test directory must have a main.kcl file.
/// This will also recursively search for directories within the given path.
///
/// # Example
///
/// ```rust,ignore
/// #[test_all_dirs("./test_data")]
/// fn test_directory(dir_name: &str, dir_path: &Path) {
///     // Your test logic here, will be executed once for each directory
///     assert!(dir_path.is_dir());
///     println!("Testing directory: {}", dir_name);
/// }
/// ```
///
/// A particular invocation can omit known-incompatible directories while
/// other invocations continue to cover them:
///
/// ```rust,ignore
/// #[test_all_dirs("./test_data", exclude = ["blocked_fixture"])]
/// fn test_directory(dir_name: &str, dir_path: &Path) {
///     // ...
/// }
/// ```
#[proc_macro_attribute]
pub fn test_all_dirs(attr: TokenStream, item: TokenStream) -> TokenStream {
    // Parse the path and any directories this invocation should exclude.
    let args = parse_macro_input!(attr as TestAllDirsArgs);
    let path_literal = args.path;
    let path = path_literal.value();
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
                path_literal,
                format!("Failed to read directories `{}`: {}", path.display(), e),
            )
            .to_compile_error()
            .into();
        }
    };
    let dirs = dirs
        .into_iter()
        .filter(|(dir_name, _)| !args.exclude.contains(dir_name))
        .collect::<Vec<_>>();

    // Generate a test function for each directory
    let test_fns = dirs.iter().map(|(dir_name, dir_path)| {
        let relative_path = dir_path
            .strip_prefix(&path.to_string_lossy().to_string())
            .unwrap()
            .trim();
        let test_fn_name = format_ident!("{}_{}", fn_name, sanitize_dir_name(relative_path));
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
        let new_path = entry.path();

        if new_path.is_dir()
            && !IGNORE_DIRS.contains(&new_path.file_name().and_then(|name| name.to_str()).unwrap_or(""))
        {
            // Check if the directory contains a main.kcl file.
            let main_kcl_path = new_path.join("main.kcl");
            if !main_kcl_path.exists() {
                // Recurse into the directory.
                let sub_dirs = get_all_directories(&new_path)?;
                dirs.extend(sub_dirs);
                continue;
            }
            let dir_name = new_path
                .file_name()
                .and_then(|name| name.to_str())
                .unwrap_or("unknown")
                .to_string();

            let dir_path = new_path.to_str().unwrap_or("unknown").to_string();

            dirs.push((dir_name, dir_path));
        }
    }

    Ok(dirs)
}

/// Sanitize directory name to create a valid Rust identifier
fn sanitize_dir_name(name: &str) -> String {
    let binding = name
        .replace(|c: char| !c.is_ascii_alphanumeric() && c != '_', "_")
        .replace("/", "_");
    let name = binding.trim_start_matches('_').to_string();
    name.to_case(convert_case::Case::Snake)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_path_only() {
        let args = syn::parse_str::<TestAllDirsArgs>(r#""./test_data""#).unwrap();
        assert_eq!(args.path.value(), "./test_data");
        assert!(args.exclude.is_empty());
    }

    #[test]
    fn parses_excluded_directories() {
        let args = syn::parse_str::<TestAllDirsArgs>(r#""./test_data", exclude = ["slow", "unsupported"]"#).unwrap();
        assert_eq!(args.path.value(), "./test_data");
        assert_eq!(args.exclude, ["slow", "unsupported"]);
    }
}
