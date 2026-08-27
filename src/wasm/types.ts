/**
 * Types shared across the WASM boundary.
 *
 * Kept in its own module with no runtime content: the files wasm-bindgen copies
 * into `snippets/` must not pull runtime code along with them, and a
 * types-only import is erased entirely at compile time.
 */

/** What `js_sys::Uint8Array::new` accepts on the Rust side. */
export type TypedArray = Uint8Array
