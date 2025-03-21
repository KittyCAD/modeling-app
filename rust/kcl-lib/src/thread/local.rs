//! Local implementation of threads with tokio.

pub struct JoinHandle {
    inner: tokio::task::JoinHandle<()>,
}

impl JoinHandle {
    pub fn new<F>(future: F) -> Self
    where
        F: std::future::Future<Output = ()> + Send + 'static,
    {
        Self {
            inner: tokio::spawn(future),
        }
    }
}

impl crate::thread::Thread for JoinHandle {
    fn abort(&self) {
        self.inner.abort();
    }

    fn is_finished(&self) -> bool {
        self.inner.is_finished()
    }
}
