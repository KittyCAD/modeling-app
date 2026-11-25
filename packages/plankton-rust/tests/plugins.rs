use std::{cell::RefCell, rc::Rc};

use plankton_rust::{
    Binding, Dependencies, Facet, Factory, Instance, PluginSpec, Plugins, Registry, RegistryError,
    create_plugin,
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
fn plugin_metadata_and_controls_stay_available_when_content_is_disabled() {
    let outline = create_plugin(
        PluginSpec::new("outline", "Outline", "Shows headings"),
        Dependencies::none(),
        |()| Ok(vec![Binding::new::<Panels>(|| "headings").into()]),
    );
    let empty = create_plugin(
        PluginSpec {
            enabled_by_default: false,
            ..PluginSpec::new("empty", "Empty", "An empty plugin")
        },
        Dependencies::none(),
        |()| Ok(Vec::new()),
    );

    let mut registry = Registry::new();
    registry
        .configure(vec![outline.clone().into(), empty.into()])
        .unwrap();
    let plugins = registry.get::<Plugins>();
    let [outline_record, empty_record] = plugins.as_slice() else {
        panic!("both plugins should be discoverable");
    };
    assert_eq!(outline_record.id, "outline");
    assert_eq!(outline_record.title, "Outline");
    assert_eq!(outline_record.description, "Shows headings");
    assert_eq!(empty_record.id, "empty");
    let controller = &outline_record.controller;
    assert!(controller.active.get().unwrap());
    assert!(!empty_record.controller.active.get().unwrap());

    empty_record.controller.enable(&mut registry).unwrap();
    assert!(empty_record.controller.active.get().unwrap());
    assert_eq!(registry.get::<Panels>(), ["headings"]);

    let updates = Rc::new(RefCell::new(Vec::new()));
    let _subscription = controller
        .active
        .subscribe({
            let updates = updates.clone();
            let panels = registry.observe::<Panels>();
            move |active| updates.borrow_mut().push((active, panels.get().unwrap()))
        })
        .unwrap();

    controller.toggle(&mut registry).unwrap();
    assert!(registry.get::<Panels>().is_empty());
    assert!(empty_record.controller.active.get().unwrap());
    let discoverable = registry.get::<Plugins>();
    assert!(Rc::ptr_eq(controller, &discoverable[0].controller));

    controller.toggle(&mut registry).unwrap();
    assert_eq!(
        *updates.borrow(),
        [(false, vec![]), (true, vec!["headings"])]
    );

    registry.configure(Vec::new()).unwrap();
    registry.configure(vec![outline.into()]).unwrap();
    assert!(!controller.active.get().unwrap());
    assert!(matches!(
        controller.disable(&mut registry),
        Err(RegistryError::ScopeExpired)
    ));
    assert!(
        registry.get::<Plugins>()[0]
            .controller
            .active
            .get()
            .unwrap()
    );
}

#[test]
fn activity_tracks_the_committed_graph_when_child_hooks_fail() {
    let failing = Factory::<()>::new(Dependencies::none(), |(), _| {
        Err("could not create content".into())
    });
    let on_remove = Factory::new(Dependencies::none(), |(), _| {
        Ok(Instance::new(()).on_dispose(|| Err("could not release content".into())))
    });
    let plugin = |id, child: Factory<()>| {
        create_plugin(
            PluginSpec {
                enabled_by_default: false,
                ..PluginSpec::new(id, id, "")
            },
            Dependencies::none(),
            move |()| Ok(vec![child.clone().into()]),
        )
    };

    let mut registry = Registry::new();
    registry
        .configure(vec![
            plugin("acquire", failing).into(),
            plugin("release", on_remove).into(),
        ])
        .unwrap();
    let records = registry.get::<Plugins>();
    let acquire = &records[0].controller;
    let release = &records[1].controller;

    assert!(matches!(
        acquire.enable(&mut registry),
        Err(RegistryError::Create { .. })
    ));
    assert!(!acquire.active.get().unwrap());

    release.enable(&mut registry).unwrap();
    assert!(release.active.get().unwrap());
    assert!(matches!(
        release.disable(&mut registry),
        Err(RegistryError::Settling(_))
    ));
    assert!(!release.active.get().unwrap());
    assert_eq!(registry.get::<Plugins>().len(), 2);
}

#[test]
fn activity_subscribers_only_see_changes_to_their_own_plugin() {
    let plugin = |id| {
        create_plugin(PluginSpec::new(id, id, ""), Dependencies::none(), |()| {
            Ok(Vec::new())
        })
    };
    let mut registry = Registry::new();
    registry
        .configure(vec![plugin("outline").into(), plugin("search").into()])
        .unwrap();
    let plugins = registry.get::<Plugins>();
    let outline = &plugins[0].controller;
    let search = &plugins[1].controller;
    let updates = Rc::new(RefCell::new(Vec::new()));
    let _outline_subscription = outline
        .active
        .subscribe({
            let updates = updates.clone();
            move |active| updates.borrow_mut().push(("outline", active))
        })
        .unwrap();
    let _search_subscription = search
        .active
        .subscribe({
            let updates = updates.clone();
            move |active| updates.borrow_mut().push(("search", active))
        })
        .unwrap();

    outline.disable(&mut registry).unwrap();
    search.disable(&mut registry).unwrap();
    outline.enable(&mut registry).unwrap();
    search.disable(&mut registry).unwrap();
    search.enable(&mut registry).unwrap();

    assert_eq!(
        *updates.borrow(),
        [
            ("outline", false),
            ("search", false),
            ("outline", true),
            ("search", true),
        ]
    );
}
