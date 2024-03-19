///! Web assembly utils.
use std::{
    pin::Pin,
    task::{Context, Poll},
};

/// A JsFuture that implements Send and Sync.
pub struct JsFuture(pub wasm_bindgen_futures::JsFuture);

// Safety: WebAssembly will only ever run in a single-threaded context.
unsafe impl Send for JsFuture {}
unsafe impl Sync for JsFuture {}

impl std::future::Future for JsFuture {
    type Output = Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Self::Output> {
        let mut pinned: Pin<&mut wasm_bindgen_futures::JsFuture> = Pin::new(&mut self.get_mut().0);
        pinned.as_mut().poll(cx)
    }
}

impl From<js_sys::Promise> for JsFuture {
    fn from(promise: js_sys::Promise) -> JsFuture {
        JsFuture(wasm_bindgen_futures::JsFuture::from(promise))
    }
}
