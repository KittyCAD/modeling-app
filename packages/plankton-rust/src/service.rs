use std::{
    cell::Cell,
    error::Error,
    fmt,
    future::{Future, poll_fn},
    ops::AsyncFnOnce,
    pin::pin,
    rc::Rc,
    task::Poll,
};

thread_local! {
    static EVALUATING_FACET: Cell<bool> = const { Cell::new(false) };
}

/// Marks synchronous source and combiner execution on the current thread.
pub(crate) struct FacetEvaluation(bool);

impl FacetEvaluation {
    pub(crate) fn enter() -> Self {
        Self(EVALUATING_FACET.with(|evaluating| evaluating.replace(true)))
    }
}

impl Drop for FacetEvaluation {
    fn drop(&mut self) {
        EVALUATING_FACET.with(|evaluating| evaluating.set(self.0));
    }
}

/// A service call attempted while a Facet source or combiner was running.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ServiceCallError;

impl fmt::Display for ServiceCallError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("cannot call a service during Facet evaluation")
    }
}

impl Error for ServiceCallError {}

fn check_evaluation() -> Result<(), ServiceCallError> {
    if EVALUATING_FACET.with(Cell::get) {
        Err(ServiceCallError)
    } else {
        Ok(())
    }
}

/// An owned service facade. The implementation is borrowed only for a guarded call.
pub struct ServiceHandle<T: ?Sized>(Rc<T>);

impl<T: ?Sized> Clone for ServiceHandle<T> {
    fn clone(&self) -> Self {
        Self(self.0.clone())
    }
}

impl<T: ?Sized> fmt::Debug for ServiceHandle<T> {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.debug_struct("ServiceHandle").finish_non_exhaustive()
    }
}

impl<T: ?Sized> ServiceHandle<T> {
    pub(crate) fn new(capability: Rc<T>) -> Self {
        Self(capability)
    }

    /// Whether two handles point to the same provider implementation.
    pub fn ptr_eq(&self, other: &Self) -> bool {
        Rc::ptr_eq(&self.0, &other.0)
    }

    /// Borrow the implementation for a synchronous call.
    ///
    /// ```compile_fail
    /// use plankton_rust::ServiceHandle;
    ///
    /// fn implementation(handle: &ServiceHandle<String>) -> &String {
    ///     handle.call(|service| service).unwrap()
    /// }
    /// ```
    pub fn call<R>(&self, invoke: impl FnOnce(&T) -> R) -> Result<R, ServiceCallError> {
        check_evaluation()?;
        Ok(invoke(&self.0))
    }

    /// Borrow the implementation across an async call, checking every poll.
    pub async fn call_async<R>(
        &self,
        invoke: impl AsyncFnOnce(&T) -> R,
    ) -> Result<R, ServiceCallError> {
        check_evaluation()?;
        let mut future = pin!(invoke(&self.0));
        poll_fn(|cx| match check_evaluation() {
            Ok(()) => future.as_mut().poll(cx).map(Ok),
            Err(error) => Poll::Ready(Err(error)),
        })
        .await
    }
}
