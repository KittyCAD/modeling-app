use std::{cell::RefCell, rc::Rc};

use plankton_rust::{
    Binding, Dependencies, Extension, Facet, Factory, Instance, Registry, RegistryError,
    ScopedSlot, Service,
};

struct Panels;

impl Facet for Panels {
    type Input = &'static str;
    type Output = Vec<&'static str>;

    fn combine(inputs: Vec<Self::Input>) -> Self::Output {
        inputs
    }
}

struct Controls;

impl Service for Controls {
    type Capability = ScopedSlot;
}

fn plugin() -> Factory<()> {
    Factory::keyed("plugin", Dependencies::none(), |(), scope| {
        let content = vec![Binding::new::<Panels>(|| "outline").into()];
        let (slot, controller) = scope.slot(content);
        let group = vec![slot];
        Ok(Instance::new(()).with_children(vec![
            group.into(),
            Binding::provide::<Controls>(Rc::new(controller)).into(),
        ]))
    })
}

#[test]
fn replacing_the_slot_keeps_its_controller_and_rejects_handles_from_a_previous_mount() {
    let plugin = plugin();
    let mut registry = Registry::new();
    registry.configure(vec![plugin.clone().into()]).unwrap();
    let controller = registry.required::<Controls>().unwrap();

    controller.replace(&mut registry, Vec::new()).unwrap();
    assert!(registry.get::<Panels>().is_empty());
    assert!(Rc::ptr_eq(
        &controller,
        &registry.required::<Controls>().unwrap()
    ));
    controller
        .replace(
            &mut registry,
            vec![Binding::new::<Panels>(|| "outline").into()],
        )
        .unwrap();
    assert_eq!(registry.get::<Panels>(), ["outline"]);

    registry.configure(Vec::new()).unwrap();
    assert!(matches!(
        controller.replace(&mut registry, Vec::new()),
        Err(RegistryError::ScopeExpired)
    ));
    registry.configure(vec![plugin.into()]).unwrap();
    assert!(matches!(
        controller.replace(&mut registry, Vec::new()),
        Err(RegistryError::ScopeExpired)
    ));
    assert_eq!(registry.get::<Panels>(), ["outline"]);
    registry
        .required::<Controls>()
        .unwrap()
        .replace(&mut registry, Vec::new())
        .unwrap();
    assert!(registry.get::<Panels>().is_empty());
}

#[test]
fn a_scoped_slot_works_only_with_the_registry_that_acquired_its_owner() {
    let plugin = plugin();
    let mut first = Registry::new();
    let mut second = Registry::new();
    first.configure(vec![plugin.clone().into()]).unwrap();
    second.configure(vec![plugin.into()]).unwrap();

    let controller = first.required::<Controls>().unwrap();
    assert!(matches!(
        controller.replace(&mut second, Vec::new()),
        Err(RegistryError::WrongRegistry)
    ));
    assert_eq!(second.get::<Panels>(), ["outline"]);
    controller.replace(&mut first, Vec::new()).unwrap();
    assert!(first.get::<Panels>().is_empty());
}

#[test]
fn a_slot_mounted_elsewhere_cannot_be_replaced_after_its_owner_detaches_it() {
    let slot_extension = Rc::new(RefCell::new(None::<Extension>));
    let owner = Factory::new(Dependencies::none(), {
        let slot_extension = slot_extension.clone();
        move |(), scope| {
            let (slot, controller) = scope.slot(vec![Binding::new::<Panels>(|| "outline").into()]);
            slot_extension.replace(Some(slot.clone()));
            Ok(Instance::new(()).with_children(vec![
                slot,
                Binding::provide::<Controls>(Rc::new(controller)).into(),
            ]))
        }
    });
    let mut registry = Registry::new();
    registry.configure(vec![owner.clone().into()]).unwrap();
    let controller = registry.required::<Controls>().unwrap();

    let slot = slot_extension.take().unwrap();
    registry
        .configure(vec![owner.clone().into(), slot])
        .unwrap();
    registry.replace(&owner, Vec::new()).unwrap();
    assert!(matches!(
        controller.replace(&mut registry, Vec::new()),
        Err(RegistryError::SlotNotOwned)
    ));
    assert_eq!(registry.get::<Panels>(), ["outline"]);
}
