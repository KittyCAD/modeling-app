///! Web assembly utils.
use std::{
    pin::Pin,
    task::{Context, Poll},
};

macro_rules! console_log_iter {
  ($fmt:literal) => { };
  ($fmt:literal, $arg:expr) => {
    js_sys::Array::of1(&wasm_bindgen::JsValue::from_str(&format!($fmt, $arg)))
  };
  ($fmt:literal, $($arg:expr),+) => {
    js_sys::Array::of1(&wasm_bindgen::JsValue::from_str(&format!($fmt, $arg)))
    .concat(console_log_iter!($fmt, $($arg),+))
  };
}

macro_rules! console_log {
  ($fmt:literal) => { };
  ($fmt:literal, $($arg:expr),+) => {
      web_sys::console::log(
        &console_log_iter!($fmt, $($arg),+)
      )
  };
}

pub(crate) use console_log_iter;
pub(crate) use console_log;

/// A JsFuture that implements Send and Sync.
pub struct JsFuture(pub Option<wasm_bindgen_futures::JsFuture>);

// Safety: WebAssembly will only ever run in a single-threaded context.
unsafe impl Send for JsFuture {}
unsafe impl Sync for JsFuture {}

impl std::future::Future for JsFuture {
    type Output = Result<wasm_bindgen::JsValue, wasm_bindgen::JsValue>;

    fn poll(self: Pin<&mut Self>, cx: &mut Context) -> Poll<Self::Output> {
        if let Some(future) = &mut self.get_mut().0 {
            let mut pinned = std::pin::pin!(future);
            match pinned.as_mut().poll(cx) {
                Poll::Ready(Ok(value)) => Poll::Ready(Ok(value)),
                Poll::Ready(Err(err)) => Poll::Ready(Err(err)),
                Poll::Pending => Poll::Pending,
            }
        } else {
            Poll::Ready(Err(wasm_bindgen::JsValue::from_str("Future has already been dropped")))
        }
    }
}

impl Drop for JsFuture {
    fn drop(&mut self) {
        if let Some(t) = self.0.take() {
            drop(t);
        }
    }
}

impl From<js_sys::Promise> for JsFuture {
    fn from(promise: js_sys::Promise) -> JsFuture {
        JsFuture(Some(wasm_bindgen_futures::JsFuture::from(promise)))
    }
}

/// A Promise that implements Send and Sync.
pub struct Promise(pub Option<js_sys::Promise>);

// Safety: WebAssembly will only ever run in a single-threaded context.
unsafe impl Send for Promise {}
unsafe impl Sync for Promise {}

impl From<js_sys::Promise> for Promise {
    fn from(promise: js_sys::Promise) -> Promise {
        Promise(Some(promise))
    }
}

impl Drop for Promise {
    fn drop(&mut self) {
        // Turn it into a future and drop it.
        if let Some(t) = self.0.take() {
            let future = wasm_bindgen_futures::JsFuture::from(t);
            drop(future);
        }
    }
}
