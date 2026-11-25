use std::{cell::Cell, rc::Rc};

use plankton_rust::{
    Binding, BindingOptions, Dependencies, Extension, Facet, Factory, Instance, ItemKind, ItemPath,
    PathStep, Precedence, Registry, RegistryError, RegistryInspection, plan,
};

struct Panels;

impl Facet for Panels {
    type Input = &'static str;
    type Output = Vec<&'static str>;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs
    }
}

#[test]
fn dry_run_orders_dependencies_and_keeps_first_occurrences_without_running_user_code() {
    let shared = Factory::<()>::keyed("shared", Dependencies::none(), |(), _| {
        panic!("planning must not acquire resources")
    });
    let consumer = Factory::<()>::keyed("consumer", shared.dependency("shared"), |_, _| {
        panic!("planning must not discover acquired children")
    });
    let discarded = Factory::<()>::keyed("consumer", Dependencies::none(), |(), _| {
        panic!("planning must not acquire a discarded definition")
    });
    let binding = Binding::with_options::<Panels>(
        || panic!("planning must not read bindings"),
        BindingOptions {
            key: Some("sidebar".into()),
            precedence: Precedence::High,
        },
    );
    let distinct = Binding::with_options::<Panels>(
        || panic!("planning must not read bindings"),
        BindingOptions {
            key: Some("sidebar".into()),
            precedence: Precedence::Low,
        },
    );
    let group: Vec<Extension> = vec![consumer.into(), binding.clone().into()];
    let result = plan(&[
        group.clone().into(),
        shared.into(),
        binding.into(),
        discarded.into(),
        group.into(),
        distinct.into(),
    ])
    .unwrap();

    assert_eq!(
        result
            .iter()
            .map(|item| (item.path.to_string(), item.kind()))
            .collect::<Vec<_>>(),
        [
            (
                "[0].items[0].dependencies[\"shared\"]".into(),
                ItemKind::Factory {
                    key: Some("shared".into())
                }
            ),
            (
                "[0].items[0]".into(),
                ItemKind::Factory {
                    key: Some("consumer".into())
                }
            ),
            (
                "[0].items[1]".into(),
                ItemKind::Binding {
                    contribution_key: Some("sidebar".into())
                }
            ),
            (
                "[5]".into(),
                ItemKind::Binding {
                    contribution_key: Some("sidebar".into())
                }
            ),
        ]
    );
}

#[test]
fn dry_run_reports_structured_paths_for_a_declared_cycle() {
    let inner = Factory::<()>::keyed("panel", Dependencies::none(), |(), _| {
        panic!("planning must not acquire resources")
    });
    let outer = Factory::<()>::keyed("panel", inner.dependency("inner"), |_, _| {
        panic!("planning must not acquire resources")
    });

    let error = plan(&[vec![outer.into()].into()]).unwrap_err();
    let RegistryError::DependencyCycle(paths) = error else {
        panic!("expected a dependency cycle, got {error}");
    };
    assert_eq!(
        paths,
        [
            ItemPath {
                root: 0,
                steps: vec![PathStep::Child(0)]
            },
            ItemPath {
                root: 0,
                steps: vec![PathStep::Child(0), PathStep::Dependency("inner".into())]
            },
        ]
    );
}

#[test]
fn inspection_counts_installed_bindings_and_preserves_origins_without_reading_sources() {
    futures_lite::future::block_on(async {
        let reads = Rc::new(Cell::new(0));
        let winner = Binding::with_options::<Panels>(
            {
                let reads = reads.clone();
                move || {
                    reads.set(reads.get() + 1);
                    "outline"
                }
            },
            BindingOptions {
                key: Some("sidebar".into()),
                precedence: Precedence::High,
            },
        );
        let loser = Binding::with_options::<Panels>(
            || panic!("shadowed bindings should never run"),
            BindingOptions {
                key: Some("sidebar".into()),
                precedence: Precedence::Low,
            },
        );
        let owner = Factory::keyed("workspace", Dependencies::none(), {
            let winner = winner.clone();
            move |(), _| Ok(Instance::new(()).with_children(vec![winner.clone().into()]))
        });
        let mut registry = Registry::new();
        assert_eq!(registry.inspect(), RegistryInspection::default());
        registry
            .configure(vec![
                owner.clone().into(),
                winner.clone().into(),
                loser.clone().into(),
            ])
            .await
            .unwrap();
        let first = registry.snapshot();
        let inspection = registry.inspect();

        assert_eq!(
            (inspection.factories, inspection.bindings, inspection.facets),
            (1, 2, 1)
        );
        assert_eq!(
            inspection
                .items
                .iter()
                .map(|item| (item.path.to_string(), item.origin.name.as_str()))
                .collect::<Vec<_>>(),
            [
                ("[0]".into(), "workspace"),
                ("[0].items[0]".into(), "workspace"),
                ("[2]".into(), "[2]")
            ],
        );
        assert_eq!(first.inspect(), &inspection);
        assert_eq!(first.debug::<Panels>().count(), 1);
        assert_eq!(reads.get(), 0);
        assert_eq!(registry.get::<Panels>(), ["outline"]);
        assert_eq!(reads.get(), 1);

        registry
            .configure(vec![loser.into(), owner.into()])
            .await
            .unwrap();
        let moved = registry.inspect();
        assert_eq!(moved.items[1].path.root, 1);
        assert_eq!(moved.items[1].origin.path.root, 0);
        assert_eq!(moved.items[2].path.to_string(), "[1].items[0]");
        assert_eq!(moved.items[2].origin, moved.items[1].origin);
        assert_eq!(first.inspect(), &inspection);
    });
}

#[test]
fn inspection_changes_only_when_a_new_graph_is_published() {
    futures_lite::future::block_on(async {
        let mut registry = Registry::new();
        registry
            .configure(vec![Binding::new::<Panels>(|| "original").into()])
            .await
            .unwrap();
        let original = registry.inspect();
        let failure = Factory::<()>::keyed("unpublished", Dependencies::none(), |(), _| {
            Err("acquisition failed".into())
        });
        let attempted = registry
            .configure(vec![
                Binding::new::<Panels>(|| "unpublished").into(),
                failure.into(),
            ])
            .await;
        assert!(matches!(attempted, Err(RegistryError::Create { .. })));
        assert_eq!(registry.inspect(), original);

        let committed = Factory::keyed("committed", Dependencies::none(), |(), _| {
            Ok(Instance::new(()).on_start(|| Err("startup failed".into())))
        });
        let attempted = registry.configure(vec![committed.into()]).await;
        assert!(matches!(attempted, Err(RegistryError::Settling(_))));
        let inspection = registry.inspect();
        assert_eq!(
            (inspection.factories, inspection.bindings, inspection.facets),
            (1, 0, 0)
        );
        assert_eq!(inspection.items[0].origin.name, "committed");

        registry.dispose().await.unwrap();
        assert_eq!(registry.inspect(), RegistryInspection::default());
    });
}
