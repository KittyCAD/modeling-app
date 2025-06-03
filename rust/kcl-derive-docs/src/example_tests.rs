use proc_macro2::Span;
use quote::{quote, ToTokens};

pub fn do_for_each_example_test(item: proc_macro2::TokenStream) -> proc_macro2::TokenStream {
    let item: syn::ItemFn = syn::parse2(item.clone()).unwrap();
    let mut result = proc_macro2::TokenStream::new();
    for name in TEST_NAMES {
        let mut item = item.clone();
        item.sig.ident = syn::Ident::new(
            &format!("{}_{}", item.sig.ident, name.replace('-', "_")),
            Span::call_site(),
        );
        let name = name.to_owned();
        let stmts = &item.block.stmts;
        let block = quote! {
            {
                const NAME: &str = #name;
                #(#stmts)*
            }
        };
        item.block = Box::new(syn::parse2(block).unwrap());
        result.extend(Some(item.into_token_stream()));
    }

    result
}

pub fn do_for_all_example_test(item: proc_macro2::TokenStream) -> proc_macro2::TokenStream {
    let mut item: syn::ItemFn = syn::parse2(item).unwrap();
    let len = TEST_NAMES.len();

    let stmts = &item.block.stmts;
    let test_names = TEST_NAMES.iter().map(|n| n.to_owned());
    let block = quote! {
        {
            const TEST_NAMES: [&str; #len] = [#(#test_names,)*];
            #(#stmts)*
        }
    };
    item.block = Box::new(syn::parse2(block).unwrap());

    item.into_token_stream()
}

pub const TEST_NAMES: &[&str] = &[
    "std-appearance-hexString-0",
    "std-appearance-hexString-1",
    "std-appearance-hexString-2",
    "std-appearance-hexString-3",
    "std-array-map-0",
    "std-array-map-1",
    "std-array-pop-0",
    "std-array-push-0",
    "std-array-reduce-0",
    "std-array-reduce-1",
    "std-array-reduce-2",
    "std-clone-0",
    "std-clone-1",
    "std-clone-2",
    "std-clone-3",
    "std-clone-4",
    "std-clone-5",
    "std-clone-6",
    "std-clone-7",
    "std-clone-8",
    "std-clone-9",
    "std-helix-0",
    "std-helix-1",
    "std-helix-2",
    "std-helix-3",
    "std-math-abs-0",
    "std-math-acos-0",
    "std-math-asin-0",
    "std-math-atan-0",
    "std-math-atan2-0",
    "std-math-ceil-0",
    "std-math-cos-0",
    "std-math-floor-0",
    "std-math-ln-0",
    "std-math-legLen-0",
    "std-math-legAngX-0",
    "std-math-legAngY-0",
    "std-math-log-0",
    "std-math-log10-0",
    "std-math-log2-0",
    "std-math-max-0",
    "std-math-min-0",
    "std-math-polar-0",
    "std-math-pow-0",
    "std-math-rem-0",
    "std-math-round-0",
    "std-math-sin-0",
    "std-math-sqrt-0",
    "std-math-tan-0",
    "std-offsetPlane-0",
    "std-offsetPlane-1",
    "std-offsetPlane-2",
    "std-offsetPlane-3",
    "std-offsetPlane-4",
    "std-sketch-circle-0",
    "std-sketch-circle-1",
    "std-sketch-patternTransform2d-0",
    "std-sketch-revolve-0",
    "std-sketch-revolve-1",
    "std-sketch-revolve-10",
    "std-sketch-revolve-11",
    "std-sketch-revolve-12",
    "std-sketch-revolve-2",
    "std-sketch-revolve-3",
    "std-sketch-revolve-4",
    "std-sketch-revolve-5",
    "std-sketch-revolve-6",
    "std-sketch-revolve-7",
    "std-sketch-revolve-8",
    "std-sketch-revolve-9",
    "std-sketch-getCommonEdge-0",
    "std-sketch-getOppositeEdge-0",
    "std-sketch-getPreviousAdjacentEdge-0",
    "std-sketch-getNextAdjacentEdge-0",
    "std-sketch-extrude-0",
    "std-sketch-extrude-1",
    "std-sketch-extrude-2",
    "std-sketch-extrude-3",
    "std-sketch-polygon-0",
    "std-sketch-polygon-1",
    "std-sketch-sweep-0",
    "std-sketch-sweep-1",
    "std-sketch-sweep-2",
    "std-sketch-sweep-3",
    "std-sketch-loft-0",
    "std-sketch-loft-1",
    "std-sketch-loft-2",
    "std-sketch-patternLinear2d-0",
    "std-sketch-patternLinear2d-1",
    "std-sketch-patternCircular2d-0",
    "std-sketch-circleThreePoint-0",
    "std-sketch-segStart-0",
    "std-sketch-segStartX-0",
    "std-sketch-segStartY-0",
    "std-sketch-segEnd-0",
    "std-sketch-segEndX-0",
    "std-sketch-segEndY-0",
    "std-sketch-lastSegX-0",
    "std-sketch-lastSegY-0",
    "std-sketch-segAng-0",
    "std-sketch-segLen-0",
    "std-sketch-tangentToEnd-0",
    "std-sketch-tangentToEnd-1",
    "std-sketch-tangentToEnd-2",
    "std-sketch-tangentToEnd-3",
    "std-sketch-tangentToEnd-4",
    "std-solid-appearance-0",
    "std-solid-appearance-1",
    "std-solid-appearance-2",
    "std-solid-appearance-3",
    "std-solid-appearance-4",
    "std-solid-appearance-5",
    "std-solid-appearance-6",
    "std-solid-appearance-7",
    "std-solid-appearance-8",
    "std-solid-appearance-9",
    "std-solid-chamfer-0",
    "std-solid-chamfer-1",
    "std-solid-fillet-0",
    "std-solid-fillet-1",
    "std-solid-hollow-0",
    "std-solid-hollow-1",
    "std-solid-hollow-2",
    "std-solid-patternTransform-0",
    "std-solid-patternTransform-1",
    "std-solid-patternTransform-2",
    "std-solid-patternTransform-3",
    "std-solid-patternTransform-4",
    "std-solid-patternTransform-5",
    "std-solid-shell-0",
    "std-solid-shell-1",
    "std-solid-shell-2",
    "std-solid-shell-3",
    "std-solid-shell-4",
    "std-solid-shell-5",
    "std-solid-shell-6",
    "std-solid-patternLinear3d-0",
    "std-solid-patternLinear3d-1",
    "std-solid-patternLinear3d-2",
    "std-solid-patternLinear3d-3",
    "std-solid-patternCircular3d-0",
    "std-solid-patternCircular3d-1",
    "std-solid-intersect-0",
    "std-solid-intersect-1",
    "std-solid-union-0",
    "std-solid-union-1",
    "std-solid-union-2",
    "std-solid-subtract-0",
    "std-solid-subtract-1",
    "std-transform-mirror2d-0",
    "std-transform-mirror2d-1",
    "std-transform-mirror2d-2",
    "std-transform-mirror2d-3",
    "std-transform-mirror2d-4",
    "std-transform-translate-0",
    "std-transform-translate-1",
    "std-transform-translate-2",
    "std-transform-translate-3",
    "std-transform-translate-4",
    "std-transform-rotate-0",
    "std-transform-rotate-1",
    "std-transform-rotate-2",
    "std-transform-rotate-3",
    "std-transform-rotate-4",
    "std-transform-rotate-5",
    "std-transform-rotate-6",
    "std-transform-scale-0",
    "std-transform-scale-1",
    "std-transform-scale-2",
    "std-units-toDegrees-0",
    "std-units-toRadians-0",
];
