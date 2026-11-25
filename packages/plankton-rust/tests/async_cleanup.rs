use std::{
    cell::{Cell, RefCell},
    future::{Future, poll_fn},
    rc::Rc,
    task::{Context, Poll, Waker},
};

use futures_lite::future::{block_on, yield_now};
use plankton_rust::{
    Binding, Dependencies, Facet, Factory, HookPhase, Instance, Registry, RegistryError,
};

struct Labels;

impl Facet for Labels {
    type Input = &'static str;
    type Output = Vec<&'static str>;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs
    }
}

async fn wait_for_gate(gate: &Cell<bool>) {
    poll_fn(|_| {
        if gate.get() {
            Poll::Ready(())
        } else {
            Poll::Pending
        }
    })
    .await;
}

#[test]
fn replacement_awaits_stop_child_owner_and_dependency_before_startup() {
    block_on(async {
        let events = Rc::new(RefCell::new(Vec::new()));
        let allow_stop = Rc::new(Cell::new(false));
        let allow_dispose = Rc::new(Cell::new(false));
        let dependency = Factory::new(Dependencies::none(), {
            let events = events.clone();
            move |(), _| {
                let events = events.clone();
                Ok(Instance::new(()).on_dispose(move || {
                    events.borrow_mut().push("dispose dependency");
                    Ok(())
                }))
            }
        });
        let child = Factory::new(Dependencies::none(), {
            let events = events.clone();
            let allow_stop = allow_stop.clone();
            let allow_dispose = allow_dispose.clone();
            move |(), _| {
                let stop_events = events.clone();
                let dispose_events = events.clone();
                let allow_stop = allow_stop.clone();
                let allow_dispose = allow_dispose.clone();
                Ok(Instance::new(())
                    .on_start_with_async_cleanup(move || {
                        Ok(move || async move {
                            stop_events.borrow_mut().push("begin stop");
                            wait_for_gate(&allow_stop).await;
                            stop_events.borrow_mut().push("end stop");
                            Ok(())
                        })
                    })
                    .on_dispose_async(move || async move {
                        dispose_events.borrow_mut().push("begin dispose child");
                        wait_for_gate(&allow_dispose).await;
                        dispose_events.borrow_mut().push("end dispose child");
                        Ok(())
                    }))
            }
        });
        let owner = Factory::new(dependency.dependency("dependency"), {
            let events = events.clone();
            move |_, _| {
                let events = events.clone();
                Ok(Instance::new(())
                    .with_children(vec![
                        child.clone().into(),
                        Binding::new::<Labels>(|| "old").into(),
                    ])
                    .on_dispose(move || {
                        events.borrow_mut().push("dispose owner");
                        Ok(())
                    }))
            }
        });
        let replacement = Factory::new(Dependencies::none(), {
            let events = events.clone();
            move |(), _| {
                let events = events.clone();
                Ok(Instance::new(())
                    .with_children(vec![Binding::new::<Labels>(|| "new").into()])
                    .on_start(move || {
                        events.borrow_mut().push("start replacement");
                        Ok(())
                    }))
            }
        });
        let mut registry = Registry::new();
        registry.configure(vec![owner.into()]).await.unwrap();
        let observation = registry.observe::<Labels>();
        let _subscription = observation
            .subscribe({
                let events = events.clone();
                move |labels| {
                    assert_eq!(labels, ["new"]);
                    events.borrow_mut().push("notify");
                }
            })
            .unwrap();

        let mut operation = Box::pin(registry.configure(vec![replacement.into()]));
        let mut cx = Context::from_waker(Waker::noop());
        assert!(operation.as_mut().poll(&mut cx).is_pending());
        assert_eq!(observation.get().unwrap(), ["new"]);
        assert_eq!(*events.borrow(), ["begin stop"]);

        allow_stop.set(true);
        assert!(operation.as_mut().poll(&mut cx).is_pending());
        assert_eq!(
            *events.borrow(),
            ["begin stop", "end stop", "begin dispose child"]
        );

        allow_dispose.set(true);
        operation.await.unwrap();
        assert_eq!(
            *events.borrow(),
            [
                "begin stop",
                "end stop",
                "begin dispose child",
                "end dispose child",
                "dispose owner",
                "dispose dependency",
                "start replacement",
                "notify",
            ]
        );
    });
}

#[test]
fn async_hook_errors_do_not_skip_later_hooks_or_reverse_publication() {
    block_on(async {
        let retired = Factory::keyed("retired", Dependencies::none(), |(), _| {
            Ok(Instance::new(())
                .on_start_with_async_cleanup(|| {
                    Ok(|| async {
                        yield_now().await;
                        Err("stop failed".into())
                    })
                })
                .on_dispose_async(|| async {
                    yield_now().await;
                    Err("dispose failed".into())
                }))
        });
        let replacement = Factory::keyed("replacement", Dependencies::none(), |(), _| {
            Ok(Instance::new(()).on_start(|| Err("start failed".into())))
        });
        let mut registry = Registry::new();
        registry.configure(vec![retired.into()]).await.unwrap();

        let result = registry.configure(vec![replacement.into()]).await;
        let Err(RegistryError::Settling(failures)) = result else {
            panic!("expected all lifecycle errors");
        };
        assert_eq!(
            failures
                .iter()
                .map(|failure| (
                    failure.origin.name.as_str(),
                    failure.phase,
                    failure.source.to_string()
                ))
                .collect::<Vec<_>>(),
            [
                ("retired", HookPhase::Stop, "stop failed".into()),
                ("retired", HookPhase::Dispose, "dispose failed".into()),
                ("replacement", HookPhase::Start, "start failed".into()),
            ],
        );
        assert_eq!(registry.inspect().items[0].origin.name, "replacement");
    });
}

#[test]
fn a_dropped_rollback_can_be_finished_and_preserves_both_failures() {
    block_on(async {
        let allow_dispose = Rc::new(Cell::new(false));
        let started = Rc::new(Cell::new(false));
        let acquired = Factory::keyed("acquired", Dependencies::none(), {
            let allow_dispose = allow_dispose.clone();
            let started = started.clone();
            move |(), _| {
                let allow_dispose = allow_dispose.clone();
                let started = started.clone();
                Ok(Instance::new(())
                    .on_start(move || {
                        started.set(true);
                        Ok(())
                    })
                    .on_dispose_async(move || async move {
                        wait_for_gate(&allow_dispose).await;
                        Err("rollback dispose failed".into())
                    }))
            }
        });
        let broken = Factory::<()>::keyed("broken", acquired.dependency("requires"), |_, _| {
            Err("acquisition failed".into())
        });
        let mut registry = Registry::new();
        registry
            .configure(vec![Binding::new::<Labels>(|| "old").into()])
            .await
            .unwrap();
        let previous = registry.inspect();

        let mut operation = Box::pin(registry.configure(vec![broken.into()]));
        assert!(
            operation
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop()))
                .is_pending()
        );
        drop(operation);
        assert_eq!(registry.inspect(), previous);

        allow_dispose.set(true);
        let Err(RegistryError::Rollback { cause, failures }) = registry.finish_pending().await
        else {
            panic!("expected acquisition and rollback errors");
        };
        assert!(matches!(*cause, RegistryError::Create { origin, .. } if origin.name == "broken"));
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].source.to_string(), "rollback dispose failed");
        assert!(!started.get());
        assert_eq!(registry.get::<Labels>(), ["old"]);
    });
}

#[test]
fn dropping_a_pending_shutdown_keeps_it_terminal_and_resumes_cleanup_once() {
    block_on(async {
        let calls = Rc::new(Cell::new(0));
        let allow_dispose = Rc::new(Cell::new(false));
        let owner = Factory::new(Dependencies::none(), {
            let calls = calls.clone();
            let allow_dispose = allow_dispose.clone();
            move |(), _| {
                let calls = calls.clone();
                let allow_dispose = allow_dispose.clone();
                Ok(Instance::new(()).on_dispose_async(move || async move {
                    calls.set(calls.get() + 1);
                    wait_for_gate(&allow_dispose).await;
                    Ok(())
                }))
            }
        });
        let mut registry = Registry::new();
        registry.configure(vec![owner.into()]).await.unwrap();

        let mut shutdown = Box::pin(registry.dispose());
        assert!(
            shutdown
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop()))
                .is_pending()
        );
        drop(shutdown);
        assert_eq!(registry.inspect().factories, 0);
        assert_eq!(calls.get(), 1);

        let mut configure =
            Box::pin(registry.configure(vec![Binding::new::<Labels>(|| "late").into()]));
        assert!(
            configure
                .as_mut()
                .poll(&mut Context::from_waker(Waker::noop()))
                .is_pending()
        );
        allow_dispose.set(true);
        assert!(matches!(configure.await, Err(RegistryError::Disposed)));
        assert_eq!(calls.get(), 1);
        assert!(registry.get::<Labels>().is_empty());
    });
}
