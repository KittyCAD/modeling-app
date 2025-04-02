// Unbox a Vec<Box<T>> to Vec<T>.
// Unbox a Box<T> to T.
pub(crate) fn unbox(t: syn::Type) -> syn::Type {
    unbox_inner(unbox_vec(t))
}

// Unbox a syn::Type that is boxed to the inner object.
fn unbox_inner(t: syn::Type) -> syn::Type {
    match t {
        syn::Type::Path(syn::TypePath { ref path, .. }) => {
            let path = &path.segments;
            if path.len() == 1 {
                let seg = &path[0];
                if seg.ident == "Box" {
                    if let syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments { args, .. }) =
                        &seg.arguments
                    {
                        if args.len() == 1 {
                            let mut args = args.iter();
                            let ok = args.next().unwrap();
                            if let syn::GenericArgument::Type(ty) = ok {
                                return ty.clone();
                            }
                        }
                    }
                }
            }
        }
        _ => {
            return t;
        }
    }
    t
}

// For a Vec<Box<T>> return Vec<T>.
// For a Vec<T> return Vec<T>.
fn unbox_vec(t: syn::Type) -> syn::Type {
    match t {
        syn::Type::Path(syn::TypePath { ref path, .. }) => {
            let path = &path.segments;
            if path.len() == 1 {
                let seg = &path[0];
                if seg.ident == "Vec" {
                    if let syn::PathArguments::AngleBracketed(syn::AngleBracketedGenericArguments { args, .. }) =
                        &seg.arguments
                    {
                        if args.len() == 1 {
                            let mut args = args.iter();
                            let ok = args.next().unwrap();
                            if let syn::GenericArgument::Type(ty) = ok {
                                let unboxed = unbox(ty.clone());
                                // Wrap it back in a vec.
                                let wrapped = syn::Type::Path(syn::TypePath {
                                    qself: None,
                                    path: syn::Path {
                                        leading_colon: None,
                                        segments: {
                                            let mut segments = syn::punctuated::Punctuated::new();
                                            segments.push_value(syn::PathSegment {
                                                ident: syn::Ident::new("Vec", proc_macro2::Span::call_site()),
                                                arguments: syn::PathArguments::AngleBracketed(
                                                    syn::AngleBracketedGenericArguments {
                                                        colon2_token: None,
                                                        lt_token: syn::token::Lt::default(),
                                                        args: {
                                                            let mut args = syn::punctuated::Punctuated::new();
                                                            args.push_value(syn::GenericArgument::Type(unboxed));
                                                            args
                                                        },
                                                        gt_token: syn::token::Gt::default(),
                                                    },
                                                ),
                                            });
                                            segments
                                        },
                                    },
                                });
                                return wrapped;
                            }
                        }
                    }
                }
            }
        }
        _ => {
            return t;
        }
    }
    t
}
