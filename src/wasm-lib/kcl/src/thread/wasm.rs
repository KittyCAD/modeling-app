//! Implementation of thread using Promise for wasm.

pub struct JoinHandle {
    inner: Option<crate::wasm::Promise>,
}

impl JoinHandle {
    pub fn new<F>(future: F) -> Self
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        Self {
            inner: Some(
                wasm_bindgen_futures::future_to_promise(async move {
                    future.await;
                    Ok(wasm_bindgen::JsValue::NULL)
                })
                .into(),
            ),
        }
    }
}

impl crate::thread::Thread for JoinHandle {
    fn abort(&self) {
        if let Some(promise) = &self.inner {
            let future = crate::wasm::JsFuture::from(promise.0.as_ref().unwrap().clone());
            drop(future);
        }
    }

    fn is_finished(&self) -> bool {
        // no-op for now but we don't need it.
        true
    }
}
