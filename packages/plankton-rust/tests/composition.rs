use std::{cell::Cell, rc::Rc};

use plankton_rust::{
    Binding, BindingOptions, Dependencies, Facet, Factory, Instance, Precedence, Registry,
    Resolution, Service, ServiceResolutionError, slot,
};

struct Panels;

impl Facet for Panels {
    type Input = &'static str;
    type Output = Vec<&'static str>;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs
    }
}

struct PanelCount;

impl Facet for PanelCount {
    type Input = &'static str;
    type Output = usize;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs.len()
    }
}

#[test]
fn publication_preserves_facet_identity_and_old_snapshots() {
    futures_lite::future::block_on(async {
        let title = Rc::new(Cell::new("outline"));
        let live_panel = Binding::new::<Panels>({
            let title = title.clone();
            move || title.get()
        });
        let sidebar = slot(vec![
            live_panel.clone().into(),
            vec![
                live_panel.into(),
                Binding::new::<PanelCount>(|| "outline").into(),
            ]
            .into(),
        ]);
        let mut registry = Registry::new();
        let mut other = Registry::new();
        let observed = registry.observe::<Panels>();
        registry
            .configure(vec![sidebar.clone().into()])
            .await
            .unwrap();
        other.configure(vec![sidebar.clone().into()]).await.unwrap();

        let snapshot = registry.snapshot();
        assert_eq!(snapshot.get::<Panels>(), ["outline"]);
        assert_eq!(snapshot.get::<PanelCount>(), 1);
        title.set("files");
        assert_eq!(observed.get().unwrap(), ["files"]);

        registry
            .replace(&sidebar, vec![Binding::new::<Panels>(|| "search").into()])
            .await
            .unwrap();
        assert_eq!(observed.get().unwrap(), ["search"]);
        assert_eq!(registry.get::<PanelCount>(), 0);
        assert_eq!(snapshot.get::<Panels>(), ["files"]);
        assert_eq!(snapshot.get::<PanelCount>(), 1);
        assert_eq!(other.get::<Panels>(), ["files"]);
        assert_eq!(other.get::<PanelCount>(), 1);
    });
}

#[test]
fn precedence_selects_the_highest_contribution_and_breaks_ties_by_order() {
    futures_lite::future::block_on(async {
        let keyed = |value, precedence| {
            Binding::with_options::<Panels>(
                move || value,
                BindingOptions {
                    key: Some("sidebar".into()),
                    precedence,
                },
            )
        };
        let bindings = [
            keyed("low", Precedence::Low),
            keyed("high one", Precedence::High),
            keyed("high two", Precedence::High),
        ];

        for order in [
            [0, 1, 2],
            [0, 2, 1],
            [1, 0, 2],
            [1, 2, 0],
            [2, 0, 1],
            [2, 1, 0],
        ] {
            let mut registry = Registry::new();
            let mut items: Vec<_> = order.map(|index| bindings[index].clone().into()).into();
            items.extend([
                Binding::new::<Panels>(|| "unkeyed").into(),
                Binding::new::<Panels>(|| "unkeyed").into(),
            ]);
            registry.configure(items).await.unwrap();

            let winner = if order == [0, 1, 2] || order[0] == 1 {
                "high one"
            } else {
                "high two"
            };
            assert_eq!(registry.get::<Panels>(), [winner, "unkeyed", "unkeyed"]);
            assert_eq!(registry.snapshot().debug::<Panels>().count(), 3);
        }
    });
}

trait FileAccess {
    fn read(&self) -> &'static str;
}

struct Reader(&'static str);

impl FileAccess for Reader {
    fn read(&self) -> &'static str {
        self.0
    }
}

struct Files;
struct BackupFiles;

impl Service for Files {
    type Capability = dyn FileAccess;
}

impl Service for BackupFiles {
    type Capability = dyn FileAccess;
}

#[test]
fn services_with_the_same_trait_resolve_independently_and_report_conflicts() {
    futures_lite::future::block_on(async {
        let local = Factory::keyed("local files", Dependencies::none(), |(), _| {
            Ok(Instance::new(()).with_children(vec![
                Binding::provide::<Files>(Rc::new(Reader("local"))).into(),
                Binding::provide::<BackupFiles>(Rc::new(Reader("backup"))).into(),
            ]))
        });
        let cloud = Factory::keyed("cloud files", Dependencies::none(), |(), _| {
            Ok(Instance::new(()).with_children(vec![
                Binding::provide::<Files>(Rc::new(Reader("cloud"))).into(),
            ]))
        });
        let mut registry = Registry::new();
        let observed = registry.observe_service::<Files>();
        assert!(matches!(observed.get().unwrap(), Resolution::Missing));
        assert!(registry.optional::<Files>().unwrap().is_none());
        assert!(matches!(
            registry.required::<Files>(),
            Err(ServiceResolutionError::Missing { service }) if service == std::any::type_name::<Files>()
        ));

        registry
            .configure(vec![local.clone().into(), cloud.into()])
            .await
            .unwrap();
        let Resolution::Conflict(origins) = observed.get().unwrap() else {
            panic!("both file providers should be reported");
        };
        assert_eq!(
            origins
                .iter()
                .map(|origin| origin.name.as_str())
                .collect::<Vec<_>>(),
            ["local files", "cloud files"]
        );
        for result in [
            registry.optional::<Files>(),
            registry.required::<Files>().map(Some),
        ] {
            assert!(matches!(
                result,
                Err(ServiceResolutionError::Conflict { service, providers })
                    if service == std::any::type_name::<Files>() && providers == origins
            ));
        }
        let backup = registry.required::<BackupFiles>().unwrap();
        assert_eq!(backup.call(|service| service.read()).unwrap(), "backup");

        registry.configure(vec![local.into()]).await.unwrap();
        let Resolution::Ready(files) = observed.get().unwrap() else {
            panic!("the remaining provider should resolve");
        };
        let optional = registry.optional::<Files>().unwrap().unwrap();
        assert!(files.ptr_eq(&optional));
        registry.configure(Vec::new()).await.unwrap();
        assert_eq!(files.call(|service| service.read()).unwrap(), "local");
        assert!(matches!(observed.get().unwrap(), Resolution::Missing));
    });
}
