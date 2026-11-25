use std::{
    cell::{Cell, RefCell},
    future::Future,
    pin::pin,
    rc::Rc,
    task::{Context, Poll, Waker},
};

use futures_lite::future::{block_on, yield_now};
use plankton_rust::{Binding, Dependencies, Facet, Factory, Instance, Registry, RegistryError};

struct MutationAttempt;

impl Facet for MutationAttempt {
    type Input = Result<(), RegistryError>;
    type Output = Option<Self::Input>;

    fn combine(mut inputs: Vec<Self::Input>) -> Self::Output {
        inputs.pop()
    }
}

fn poll_once<T>(future: impl Future<Output = T>) -> Poll<T> {
    pin!(future).poll(&mut Context::from_waker(Waker::noop()))
}

#[test]
fn captured_snapshot_cannot_mutate_its_live_registry() {
    let registry = Rc::new(RefCell::new(Registry::new()));
    let source = Binding::new::<MutationAttempt>({
        let registry = Rc::downgrade(&registry);
        move || {
            let registry = registry.upgrade().unwrap();
            let mut registry = registry.borrow_mut();
            let Poll::Ready(result) = poll_once(registry.configure(Vec::new())) else {
                panic!("a rejected mutation should complete immediately");
            };
            result
        }
    });
    block_on(registry.borrow_mut().configure(vec![source.into()])).unwrap();
    let snapshot = registry.borrow().snapshot();

    assert!(matches!(
        snapshot.get::<MutationAttempt>(),
        Some(Err(RegistryError::FacetEvaluation))
    ));
    assert_eq!(registry.borrow().inspect().bindings, 1);
    block_on(registry.borrow_mut().configure(Vec::new())).unwrap();
    assert_eq!(registry.borrow().inspect().bindings, 0);
}

#[test]
fn facet_evaluation_cannot_resume_a_registry_mutation_that_already_started() {
    let cleaned_up = Rc::new(Cell::new(false));
    let retired = Factory::new(Dependencies::none(), {
        let cleaned_up = cleaned_up.clone();
        move |(), _| {
            let cleaned_up = cleaned_up.clone();
            Ok(Instance::new(()).on_dispose_async(move || async move {
                yield_now().await;
                cleaned_up.set(true);
                Ok(())
            }))
        }
    });
    let mut target = Registry::new();
    block_on(target.configure(vec![retired.into()])).unwrap();

    let returned = Rc::new(RefCell::new(None));
    let mut mutation = Box::pin({
        let returned = returned.clone();
        async move {
            let result = target.configure(Vec::new()).await;
            returned.replace(Some(target));
            result
        }
    });
    assert!(poll_once(mutation.as_mut()).is_pending());

    let mut reader = Registry::new();
    let mutation = RefCell::new(mutation);
    let probe = Binding::new::<MutationAttempt>(move || {
        let Poll::Ready(result) = poll_once(mutation.borrow_mut().as_mut()) else {
            panic!("a rejected mutation should complete immediately");
        };
        result
    });
    block_on(reader.configure(vec![probe.into()])).unwrap();

    assert!(matches!(
        reader.snapshot().get::<MutationAttempt>(),
        Some(Err(RegistryError::FacetEvaluation))
    ));
    assert!(!cleaned_up.get());
    let mut target = returned.take().unwrap();
    block_on(target.finish_pending()).unwrap();
    assert!(cleaned_up.get());
}
