use std::{
    cell::{Cell, RefCell},
    future::Future,
    panic::{AssertUnwindSafe, catch_unwind},
    rc::Rc,
    task::{Context, Poll, Waker},
};

use futures_lite::future::{block_on, yield_now};
use plankton_rust::{
    Binding, BindingOptions, ContributionInfo, Dependencies, Facet, Factory, Instance, ItemPath,
    Origin, Precedence, Registry, Service, ServiceCallError, ServiceDebug, ServiceHandle,
};

trait Counter {
    fn increment(&self) -> usize;
}

impl Counter for Cell<usize> {
    fn increment(&self) -> usize {
        let count = self.get() + 1;
        self.set(count);
        count
    }
}

struct CounterService;

impl Service for CounterService {
    type Capability = dyn Counter;
}

struct CallResults;

impl Facet for CallResults {
    type Input = Result<usize, ServiceCallError>;
    type Output = Vec<Self::Input>;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs
    }
}

struct CallInCombiner;

impl Facet for CallInCombiner {
    type Input = ServiceHandle<dyn Counter>;
    type Output = Vec<Result<usize, ServiceCallError>>;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs
            .iter()
            .map(|handle| handle.call(|counter| counter.increment()))
            .collect()
    }
}

#[test]
fn sources_and_combiners_reject_calls_through_retained_handles() {
    block_on(async {
        let counter = Rc::new(Cell::new(0));
        let mut providers = Registry::new();
        providers
            .configure(vec![
                Binding::provide::<CounterService>(counter.clone()).into(),
            ])
            .await
            .unwrap();
        let provider_snapshot = providers.snapshot();
        let handle = providers.required::<CounterService>().unwrap();
        assert_eq!(handle.call(|counter| counter.increment()), Ok(1));

        let mut consumer = Registry::new();
        consumer
            .configure(vec![
                Binding::new::<CallResults>({
                    let handle = handle.clone();
                    move || {
                        // Resolution evaluates its own provider Facet. Returning
                        // from that nested read must leave the outer guard active.
                        let nested = provider_snapshot.required::<CounterService>().unwrap();
                        assert!(nested.ptr_eq(&handle));
                        handle.call(|counter| counter.increment())
                    }
                })
                .into(),
                Binding::new::<CallInCombiner>({
                    let handle = handle.clone();
                    move || handle.clone()
                })
                .into(),
            ])
            .await
            .unwrap();

        assert_eq!(
            consumer.observe::<CallResults>().get().unwrap(),
            [Err(ServiceCallError)]
        );
        assert_eq!(
            consumer.snapshot().get::<CallInCombiner>(),
            [Err(ServiceCallError)]
        );
        assert_eq!(counter.get(), 1);
        assert_eq!(handle.call(|counter| counter.increment()), Ok(2));
    });
}

#[test]
fn an_async_call_cannot_resume_during_facet_evaluation() {
    block_on(async {
        let counter = Rc::new(Cell::new(0));
        let mut registry = Registry::new();
        let provider = Binding::provide::<CounterService>(counter.clone());
        registry
            .configure(vec![provider.clone().into()])
            .await
            .unwrap();
        let handle = registry.required::<CounterService>().unwrap();

        let mut future = Box::pin({
            let handle = handle.clone();
            async move {
                handle
                    .call_async(async |counter| {
                        let started = counter.increment();
                        yield_now().await;
                        started + counter.increment()
                    })
                    .await
            }
        });
        assert!(
            future
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop()))
                .is_pending()
        );
        assert_eq!(counter.get(), 1);

        let future = RefCell::new(future);
        registry
            .configure(vec![
                provider.into(),
                Binding::new::<CallResults>(move || {
                    let mut future = future.borrow_mut();
                    let Poll::Ready(result) = future
                        .as_mut()
                        .poll(&mut Context::from_waker(Waker::noop()))
                    else {
                        panic!("guarded polling should return a service call error");
                    };
                    result
                })
                .into(),
            ])
            .await
            .unwrap();

        assert_eq!(registry.get::<CallResults>(), [Err(ServiceCallError)]);
        assert_eq!(counter.get(), 1);
        assert_eq!(
            handle
                .call_async(async |counter| {
                    yield_now().await;
                    counter.increment()
                })
                .await,
            Ok(2)
        );
    });
}

#[test]
fn unwinding_a_facet_source_restores_service_access() {
    block_on(async {
        let mut registry = Registry::new();
        registry
            .configure(vec![
                Binding::provide::<CounterService>(Rc::new(Cell::new(0))).into(),
                Binding::new::<CallResults>(|| panic!("facet source panic")).into(),
            ])
            .await
            .unwrap();
        let handle = registry.required::<CounterService>().unwrap();

        assert!(catch_unwind(AssertUnwindSafe(|| registry.get::<CallResults>())).is_err());
        assert_eq!(handle.call(|counter| counter.increment()), Ok(1));
    });
}

#[test]
fn service_debug_observes_provider_origins_and_conflicts_without_calling_the_service() {
    struct MustNotCall;
    impl Counter for MustNotCall {
        fn increment(&self) -> usize {
            panic!("inspecting a provider must not call it");
        }
    }

    let provider = |name: &'static str, precedence| {
        Factory::keyed(name, Dependencies::none(), move |(), _| {
            Ok(Instance::new(()).with_children(vec![
                Binding::provide_with_options::<CounterService>(
                    Rc::new(MustNotCall),
                    BindingOptions {
                        key: Some(name.into()),
                        precedence,
                    },
                )
                .into(),
            ]))
        })
    };
    let local = provider("local", Precedence::Default);
    let remote = provider("remote", Precedence::High);

    block_on(async {
        let mut registry = Registry::new();
        let debug = registry.debug_service::<CounterService>();
        assert_eq!(debug.get().unwrap(), ServiceDebug::Missing);
        let updates = Rc::new(RefCell::new(Vec::new()));
        let _subscription = debug
            .subscribe({
                let updates = updates.clone();
                move |metadata| updates.borrow_mut().push(metadata)
            })
            .unwrap();

        registry
            .configure(vec![local.clone().into()])
            .await
            .unwrap();
        registry
            .configure(vec![local.into(), remote.clone().into()])
            .await
            .unwrap();
        registry.configure(vec![remote.into()]).await.unwrap();

        let metadata = |name: &str, root, precedence| ContributionInfo {
            origin: Origin {
                name: name.into(),
                path: ItemPath {
                    root,
                    steps: Vec::new(),
                },
            },
            key: Some(name.into()),
            precedence,
        };
        let local = metadata("local", 0, Precedence::Default);
        let remote = metadata("remote", 1, Precedence::High);
        assert_eq!(debug.get().unwrap(), ServiceDebug::Ready(remote.clone()));
        registry.dispose().await.unwrap();
        assert_eq!(
            *updates.borrow(),
            [
                ServiceDebug::Ready(local.clone()),
                ServiceDebug::Conflict(vec![remote.clone(), local]),
                ServiceDebug::Ready(remote),
                ServiceDebug::Missing,
            ]
        );
    });
}
