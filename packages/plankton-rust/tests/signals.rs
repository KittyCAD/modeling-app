use std::{cell::RefCell, rc::Rc};

use plankton_rust::{
    Binding, BindingOptions, Dependencies, Facet, Factory, Instance, Precedence, Registry,
    RegistryError, Signal, Source, slot,
};

struct Labels;

impl Facet for Labels {
    type Input = &'static str;
    type Output = Vec<&'static str>;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs
    }
}

#[test]
fn one_subscription_sees_document_edits_and_the_replaced_sidebar() {
    futures_lite::future::block_on(async {
        let title = Signal::new("draft");
        let view = title.read_only();
        let source: Box<dyn Source<&'static str>> = Box::new({
            let view = view.clone();
            move || view.get()
        });
        let panel = Binding::new::<Labels>(source).depending_on(&view);
        let sidebar = slot(vec![Binding::new::<Labels>(|| "outline").into()]);
        let mut registry = Registry::new();
        registry
            .configure(vec![panel.into(), sidebar.clone().into()])
            .await
            .unwrap();

        let renders = Rc::new(RefCell::new(Vec::new()));
        let observation = registry.observe::<Labels>();
        let subscription = observation
            .subscribe({
                let renders = renders.clone();
                move |panels| renders.borrow_mut().push(panels)
            })
            .unwrap();
        assert!(renders.borrow().is_empty());

        title.set("sketch");
        registry
            .replace(&sidebar, vec![Binding::new::<Labels>(|| "search").into()])
            .await
            .unwrap();
        title.set("scene");
        drop(subscription);
        title.set("done");
        assert_eq!(
            *renders.borrow(),
            [
                vec!["sketch", "outline"],
                vec!["sketch", "search"],
                vec!["scene", "search"],
            ]
        );
        assert_eq!(observation.get().unwrap(), ["done", "search"]);
    });
}

#[test]
fn only_effective_declared_dependencies_invalidate_and_removed_signals_disconnect() {
    futures_lite::future::block_on(async {
        let winner = Signal::new("winner");
        let loser = Signal::new("loser");
        let undeclared = Signal::new("initial");
        let binding = |signal: &Signal<&'static str>, precedence| {
            Binding::with_options::<Labels>(
                {
                    let signal = signal.clone();
                    let undeclared = undeclared.clone();
                    move || {
                        if undeclared.get() == "initial" {
                            signal.get()
                        } else {
                            "updated"
                        }
                    }
                },
                BindingOptions {
                    key: Some("label".into()),
                    precedence,
                },
            )
            .depending_on(signal)
        };
        let roots = vec![
            binding(&loser, Precedence::Low).into(),
            binding(&winner, Precedence::High).into(),
        ];
        let mut registry = Registry::new();
        registry.configure(roots.clone()).await.unwrap();
        let historical = registry.snapshot();
        let renders = Rc::new(RefCell::new(Vec::new()));
        let _subscription = registry
            .observe::<Labels>()
            .subscribe({
                let renders = renders.clone();
                move |panels| renders.borrow_mut().push(panels)
            })
            .unwrap();

        loser.set("still hidden");
        undeclared.set("later");
        registry.configure(roots).await.unwrap();
        assert!(renders.borrow().is_empty());
        winner.set("still visible");
        registry.configure(Vec::new()).await.unwrap();
        winner.set("removed");
        assert_eq!(*renders.borrow(), [vec!["updated"], vec![]]);
        assert_eq!(historical.get::<Labels>(), ["updated"]);
    });
}

#[test]
fn failed_acquisition_delivers_signal_writes_against_the_previous_graph() {
    futures_lite::future::block_on(async {
        let title = Signal::new("draft");
        let binding = Binding::new::<Labels>({
            let title = title.clone();
            move || title.get()
        })
        .depending_on(&title);
        let old_roots = vec![binding.into(), Binding::new::<Labels>(|| "outline").into()];
        let mut registry = Registry::new();
        registry.configure(old_roots).await.unwrap();
        let renders = Rc::new(RefCell::new(Vec::new()));
        let _subscription = registry
            .observe::<Labels>()
            .subscribe({
                let renders = renders.clone();
                move |panels| renders.borrow_mut().push(panels)
            })
            .unwrap();

        let failing = Factory::<()>::new(Dependencies::none(), {
            let renders = renders.clone();
            move |(), _| {
                title.set("intermediate");
                title.set("final");
                assert!(renders.borrow().is_empty());
                Err("cannot acquire workspace".into())
            }
        });
        let result = registry
            .configure(vec![
                Binding::new::<Labels>(|| "unpublished").into(),
                failing.into(),
            ])
            .await;
        assert!(matches!(result, Err(RegistryError::Create { .. })));
        assert_eq!(*renders.borrow(), [vec!["final", "outline"]]);
    });
}

#[test]
fn a_signal_shared_by_multiple_bindings_invalidates_the_facet_once_per_write() {
    futures_lite::future::block_on(async {
        let title = Signal::new("draft");
        let binding = || {
            Binding::new::<Labels>({
                let title = title.clone();
                move || title.get()
            })
            .depending_on(&title)
        };
        let mut registry = Registry::new();
        registry
            .configure(vec![binding().into(), binding().into()])
            .await
            .unwrap();
        let renders = Rc::new(RefCell::new(Vec::new()));
        let _subscription = registry
            .observe::<Labels>()
            .subscribe({
                let renders = renders.clone();
                let title = title.clone();
                move |panels| {
                    let revise = panels == ["sketch", "sketch"];
                    renders.borrow_mut().push(panels);
                    if revise {
                        title.set("scene");
                    }
                }
            })
            .unwrap();

        title.set("sketch");
        assert_eq!(
            *renders.borrow(),
            [vec!["sketch", "sketch"], vec!["scene", "scene"]]
        );
    });
}

#[test]
fn cleanup_stops_subscriptions_before_the_replacement_is_delivered() {
    futures_lite::future::block_on(async {
        let renders = Rc::new(RefCell::new(Vec::new()));
        let owner = Factory::new(Dependencies::none(), {
            let renders = renders.clone();
            move |(), scope| {
                let renders = renders.clone();
                let panels = scope.observe::<Labels>();
                Ok(Instance::new(())
                    .with_children(vec![Binding::new::<Labels>(|| "outline").into()])
                    .on_start_with_cleanup(move || {
                        let subscription =
                            panels.subscribe(move |panels| renders.borrow_mut().push(panels))?;
                        Ok(move || {
                            drop(subscription);
                            Ok(())
                        })
                    }))
            }
        });
        let mut registry = Registry::new();
        registry.configure(vec![owner.into()]).await.unwrap();
        assert_eq!(*renders.borrow(), [vec!["outline"]]);

        registry
            .configure(vec![Binding::new::<Labels>(|| "search").into()])
            .await
            .unwrap();
        assert_eq!(*renders.borrow(), [vec!["outline"]]);
        assert_eq!(registry.get::<Labels>(), ["search"]);
    });
}
