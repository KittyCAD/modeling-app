use std::{
    cell::{Cell, RefCell},
    rc::Rc,
};

use plankton_rust::{
    Binding, Dependencies, Facet, Factory, HookPhase, Instance, ObservationError, PathStep,
    Registry, RegistryError,
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
fn a_factory_can_keep_owned_exports_and_shared_dependencies_survive_replacement() {
    futures_lite::future::block_on(async {
        struct Document(&'static str);

        let events = Rc::new(RefCell::new(Vec::new()));
        let document = Factory::new(Dependencies::none(), {
            let events = events.clone();
            move |(), _| {
                events.borrow_mut().push("create document");
                let events = events.clone();
                Ok(Instance::new(Document("document.kcl")).on_dispose(move || {
                    events.borrow_mut().push("dispose document");
                    Ok(())
                }))
            }
        });
        let consumer = |name| {
            Factory::keyed(name, document.dependency("document"), {
                let events = events.clone();
                move |document, _| {
                    let events = events.clone();
                    Ok(Instance::new(())
                        .with_children(vec![Binding::new::<Labels>(move || document.0).into()])
                        .on_dispose(move || {
                            events.borrow_mut().push(name);
                            Ok(())
                        }))
                }
            })
        };
        let left = consumer("left");
        let right = consumer("right");
        let mut registry = Registry::new();
        registry
            .configure(vec![left.clone().into(), right.clone().into()])
            .await
            .unwrap();
        assert_eq!(registry.get::<Labels>(), ["document.kcl", "document.kcl"]);

        registry
            .replace(&left, vec![Binding::new::<Labels>(|| "search").into()])
            .await
            .unwrap();
        assert_eq!(registry.get::<Labels>(), ["search", "document.kcl"]);
        registry.configure(vec![right.into()]).await.unwrap();
        assert_eq!(*events.borrow(), ["create document", "left"]);

        registry.dispose().await.unwrap();
        assert_eq!(
            *events.borrow(),
            ["create document", "left", "right", "dispose document"]
        );
        assert!(matches!(
            registry.configure(Vec::new()).await,
            Err(RegistryError::Disposed)
        ));
    });
}

#[test]
fn failed_acquisition_releases_returned_instances_and_preserves_the_published_graph() {
    futures_lite::future::block_on(async {
        let mut registry = Registry::new();
        registry
            .configure(vec![Binding::new::<Labels>(|| "original").into()])
            .await
            .unwrap();
        let observed = registry.observe::<Labels>();
        assert_eq!(observed.get().unwrap(), ["original"]);

        let started = Rc::new(Cell::new(false));
        let candidate = Factory::keyed("candidate", Dependencies::none(), {
            let started = started.clone();
            let observed = observed.clone();
            move |(), _| {
                assert_eq!(observed.get(), Err(ObservationError::Acquiring));
                let started = started.clone();
                let observed = observed.clone();
                Ok(Instance::new(())
                    .with_children(vec![Binding::new::<Labels>(|| "candidate").into()])
                    .on_start(move || {
                        started.set(true);
                        Ok(())
                    })
                    .on_dispose(move || {
                        assert_eq!(observed.get()?, ["original"]);
                        Err("rollback failed".into())
                    }))
            }
        });
        let failure = Factory::<()>::keyed("broken", Dependencies::none(), |(), _| {
            Err("create failed".into())
        });

        let result = registry
            .configure(vec![candidate.into(), failure.into()])
            .await;
        let Err(RegistryError::Rollback { cause, failures }) = result else {
            panic!("both acquisition and rollback errors should be reported");
        };
        assert!(matches!(*cause, RegistryError::Create { origin, .. } if origin.name == "broken"));
        assert_eq!(failures.len(), 1);
        assert_eq!(failures[0].origin.name, "candidate");
        assert_eq!(failures[0].phase, HookPhase::Dispose);
        assert!(!started.get());
        assert_eq!(observed.get().unwrap(), ["original"]);
    });
}

#[test]
fn publication_precedes_cleanup_and_start_runs_after_cleanup_even_when_hooks_fail() {
    futures_lite::future::block_on(async {
        let events = Rc::new(RefCell::new(Vec::new()));
        let old = Factory::new(Dependencies::none(), {
            let events = events.clone();
            move |(), scope| {
                let observed = scope.observe::<Labels>();
                let stopping = events.clone();
                let disposing = events.clone();
                Ok(Instance::new(())
                    .with_children(vec![Binding::new::<Labels>(|| "old").into()])
                    .on_start_with_cleanup(move || {
                        assert_eq!(observed.get()?, ["old"]);
                        Ok(move || {
                            assert_eq!(observed.get()?, ["new"]);
                            stopping.borrow_mut().push("stop old");
                            Err("stop failed".into())
                        })
                    })
                    .on_dispose(move || {
                        disposing.borrow_mut().push("dispose old");
                        Err("dispose failed".into())
                    }))
            }
        });
        let new = Factory::new(Dependencies::none(), {
            let events = events.clone();
            move |(), scope| {
                let observed = scope.observe::<Labels>();
                let events = events.clone();
                Ok(Instance::new(())
                    .with_children(vec![Binding::new::<Labels>(|| "new").into()])
                    .on_start(move || {
                        assert_eq!(observed.get()?, ["new"]);
                        events.borrow_mut().push("start new");
                        Err("start failed".into())
                    }))
            }
        });
        let sibling = Factory::new(Dependencies::none(), {
            let events = events.clone();
            move |(), _| {
                let events = events.clone();
                Ok(Instance::new(()).on_start(move || {
                    events.borrow_mut().push("start sibling");
                    Ok(())
                }))
            }
        });

        let mut registry = Registry::new();
        registry.configure(vec![old.into()]).await.unwrap();
        let result = registry.configure(vec![new.into(), sibling.into()]).await;
        let Err(RegistryError::Settling(failures)) = result else {
            panic!("all failed hooks should be reported after commit");
        };
        assert_eq!(
            *events.borrow(),
            ["stop old", "dispose old", "start new", "start sibling"]
        );
        assert_eq!(
            failures
                .iter()
                .map(|failure| failure.phase)
                .collect::<Vec<_>>(),
            [HookPhase::Stop, HookPhase::Dispose, HookPhase::Start]
        );
        assert_eq!(registry.get::<Labels>(), ["new"]);
    });
}

#[test]
fn a_losing_definition_cannot_supply_a_dependency_or_acquire_its_own_dependencies() {
    futures_lite::future::block_on(async {
        let acquired = Rc::new(Cell::new(false));
        let storage = Factory::new(Dependencies::none(), {
            let acquired = acquired.clone();
            move |(), _| {
                acquired.set(true);
                Ok(Instance::new(()))
            }
        });
        let winner = Factory::keyed("files", Dependencies::none(), |(), _| {
            Ok(Instance::new("local"))
        });
        let losing = Factory::keyed("files", storage.dependency("storage"), |_, _| {
            Ok(Instance::new("cloud"))
        });
        let editor = Factory::new(losing.dependency("files"), |files, _| {
            Ok(Instance::new(files))
        });

        let mut registry = Registry::new();
        let result = registry.configure(vec![winner.into(), editor.into()]).await;
        assert!(matches!(result, Err(RegistryError::DependencyMismatch(name)) if name == "files"));
        assert!(!acquired.get());
    });
}

#[test]
fn a_retained_key_rejects_a_different_export_type() {
    futures_lite::future::block_on(async {
        let owner = Factory::keyed("editor", Dependencies::none(), |(), _| {
            Ok(Instance::new(()).with_children(vec![Binding::new::<Labels>(|| "editor").into()]))
        });
        let collision = Factory::keyed("editor", Dependencies::none(), |(), _| {
            Ok(Instance::new(42))
        });
        let mut registry = Registry::new();
        registry.configure(vec![owner.into()]).await.unwrap();
        assert!(matches!(
            registry.replace(&collision, Vec::new()).await,
            Err(RegistryError::RetainedFactoryChanged(_))
        ));
        assert!(matches!(
            registry.configure(vec![collision.into()]).await,
            Err(RegistryError::RetainedFactoryChanged(_))
        ));
        assert_eq!(registry.get::<Labels>(), ["editor"]);
    });
}

#[test]
fn contradictory_ownership_releases_both_acquired_instances() {
    futures_lite::future::block_on(async {
        let events = Rc::new(RefCell::new(Vec::new()));
        let child = Factory::keyed("child", Dependencies::none(), {
            let events = events.clone();
            move |(), _| {
                let events = events.clone();
                Ok(Instance::new(()).on_dispose(move || {
                    events.borrow_mut().push("child");
                    Ok(())
                }))
            }
        });
        let owner = Factory::keyed("owner", child.dependency("child"), {
            let events = events.clone();
            move |_, _| {
                let events = events.clone();
                Ok(Instance::new(())
                    .with_children(vec![child.clone().into()])
                    .on_dispose(move || {
                        events.borrow_mut().push("owner");
                        Ok(())
                    }))
            }
        });
        let mut registry = Registry::new();
        let result = registry.configure(vec![owner.into()]).await;
        let Err(RegistryError::LifetimeCycle(origins)) = result else {
            panic!("owning a constructor dependency puts it on both sides of cleanup");
        };
        assert_eq!(origins.first(), origins.last());
        assert_eq!(origins.len(), 3);
        assert!(
            origins
                .iter()
                .any(|origin| origin.path.steps == [PathStep::Dependency("child".into())])
        );
        events.borrow_mut().sort_unstable();
        assert_eq!(*events.borrow(), ["child", "owner"]);
    });
}

#[test]
fn declared_cycles_are_rejected_before_any_factory_runs() {
    futures_lite::future::block_on(async {
        let constructors = Rc::new(Cell::new(0));
        let leaf = Factory::keyed("editor", Dependencies::none(), {
            let constructors = constructors.clone();
            move |(), _| {
                constructors.set(constructors.get() + 1);
                Ok(Instance::new(()))
            }
        });
        let root = Factory::keyed("editor", leaf.dependency("document"), {
            let constructors = constructors.clone();
            move |_, _| {
                constructors.set(constructors.get() + 1);
                Ok(Instance::new(()))
            }
        });
        let unrelated = Factory::new(Dependencies::none(), {
            let constructors = constructors.clone();
            move |(), _| {
                constructors.set(constructors.get() + 1);
                Ok(Instance::new(()))
            }
        });

        let mut registry = Registry::new();
        let result = registry
            .configure(vec![unrelated.into(), root.into()])
            .await;
        let Err(RegistryError::DependencyCycle(paths)) = result else {
            panic!("the nested use of the active key should be reported");
        };
        assert_eq!(constructors.get(), 0);
        assert_eq!(
            paths.iter().map(ToString::to_string).collect::<Vec<_>>(),
            ["[1]", "[1].dependencies[\"document\"]",]
        );
    });
}

#[test]
fn children_release_before_their_owner_even_when_mounted_as_earlier_roots() {
    futures_lite::future::block_on(async {
        let events = Rc::new(RefCell::new(Vec::new()));
        let child = Factory::new(Dependencies::none(), {
            let events = events.clone();
            move |(), _| {
                let events = events.clone();
                Ok(Instance::new(()).on_dispose(move || {
                    events.borrow_mut().push("child");
                    Ok(())
                }))
            }
        });
        let owner = Factory::new(Dependencies::none(), {
            let events = events.clone();
            let child = child.clone();
            move |(), _| {
                let events = events.clone();
                Ok(Instance::new(())
                    .with_children(vec![child.clone().into()])
                    .on_dispose(move || {
                        events.borrow_mut().push("owner");
                        Ok(())
                    }))
            }
        });

        {
            let mut registry = Registry::new();
            registry
                .configure(vec![child.into(), owner.into()])
                .await
                .unwrap();
        }
        assert_eq!(*events.borrow(), ["child", "owner"]);
    });
}

#[test]
fn replacing_children_with_an_ancestor_keeps_the_previous_graph() {
    futures_lite::future::block_on(async {
        let owner = plankton_rust::slot(vec![Binding::new::<Labels>(|| "original").into()]);
        let mut registry = Registry::new();
        registry
            .configure(vec![owner.clone().into()])
            .await
            .unwrap();

        let result = registry.replace(&owner, vec![owner.clone().into()]).await;
        let Err(RegistryError::DependencyCycle(paths)) = result else {
            panic!("an active ancestor cannot be installed as a child");
        };
        assert_eq!(
            paths.iter().map(ToString::to_string).collect::<Vec<_>>(),
            ["[0]", "[0].items[0]",]
        );
        assert_eq!(registry.get::<Labels>(), ["original"]);
        registry.replace(&owner, Vec::new()).await.unwrap();
        assert!(registry.get::<Labels>().is_empty());
    });
}

#[test]
fn declared_definitions_win_over_conflicting_children_revealed_during_acquisition() {
    futures_lite::future::block_on(async {
        let declared = Factory::keyed("editor", Dependencies::none(), |(), _| {
            Ok(Instance::new(()).with_children(vec![Binding::new::<Labels>(|| "declared").into()]))
        });
        let nested = Factory::keyed("editor", Dependencies::none(), |(), _| {
            Err::<Instance<()>, _>("the discarded child factory ran".into())
        });
        let feature = plankton_rust::slot(vec![nested.into()]);
        let mut registry = Registry::new();

        registry
            .configure(vec![feature.into(), declared.into()])
            .await
            .unwrap();
        assert_eq!(registry.get::<Labels>(), ["declared"]);
    });
}
