use std::{cell::Cell, rc::Rc};

use crate::{
    Binding, Dependencies, Extension, Facet, Factory, HookResult, Instance, Observation,
    ObservationError, Registry, RegistryError, ScopedSlot, Subscription,
};

/// Metadata and initial state for a plugin.
#[derive(Clone, Debug)]
pub struct PluginSpec {
    pub id: String,
    pub title: String,
    pub description: String,
    pub enabled_by_default: bool,
}

impl PluginSpec {
    pub fn new(
        id: impl Into<String>,
        title: impl Into<String>,
        description: impl Into<String>,
    ) -> Self {
        Self {
            id: id.into(),
            title: title.into(),
            description: description.into(),
            enabled_by_default: true,
        }
    }
}

/// A discoverable plugin and its controller. The record remains available
/// while the plugin's content is disabled.
#[derive(Clone)]
pub struct PluginRecord {
    pub id: String,
    pub title: String,
    pub description: String,
    pub controller: Rc<PluginController>,
}

/// The installed plugins, in contribution order.
pub struct Plugins;

impl Facet for Plugins {
    type Input = PluginRecord;
    type Output = Vec<PluginRecord>;

    fn combine(inputs: Vec<PluginRecord>) -> Self::Output {
        inputs
    }
}

/// The enabled state of one acquired plugin.
#[derive(Clone)]
pub struct PluginActivity(Observation<bool>);

impl PluginActivity {
    pub fn get(&self) -> Result<bool, ObservationError> {
        self.0.get()
    }

    /// Notify only when this plugin's published state changes.
    /// Registration samples the current state without calling the listener.
    pub fn subscribe(
        &self,
        listener: impl Fn(bool) + 'static,
    ) -> Result<Subscription, ObservationError> {
        let previous = Cell::new(self.get()?);
        self.0.subscribe(move |active| {
            if previous.replace(active) != active {
                listener(active);
            }
        })
    }
}

/// Controls one acquired plugin. Activity follows its published slot content.
pub struct PluginController {
    pub active: PluginActivity,
    body: ScopedSlot,
    content: Vec<Extension>,
}

impl PluginController {
    pub fn enable(&self, registry: &mut Registry) -> Result<(), RegistryError> {
        self.body.replace(registry, self.content.clone())
    }

    pub fn disable(&self, registry: &mut Registry) -> Result<(), RegistryError> {
        self.body.replace(registry, Vec::new())
    }

    pub fn toggle(&self, registry: &mut Registry) -> Result<(), RegistryError> {
        if self.active.get().unwrap_or(false) {
            self.disable(registry)
        } else {
            self.enable(registry)
        }
    }
}

/// Mark an enabled acquisition even when its content is empty. Identity is
/// per acquisition so an old controller cannot observe a later mount's state.
struct ActivePlugins;

impl Facet for ActivePlugins {
    type Input = Rc<()>;
    type Output = Vec<Rc<()>>;

    fn combine(inputs: Vec<Rc<()>>) -> Self::Output {
        inputs
    }
}

/// Build a plugin factory with discoverable metadata and replaceable content.
/// `build_content` declares extensions when the plugin is acquired, even if it
/// starts disabled. Put resources that follow the toggle in child factories.
pub fn create_plugin<D: 'static>(
    spec: PluginSpec,
    dependencies: Dependencies<D>,
    build_content: impl Fn(D) -> HookResult<Vec<Extension>> + 'static,
) -> Factory<()> {
    Factory::keyed(spec.id.clone(), dependencies, move |dependencies, scope| {
        let identity = Rc::new(());
        let active_marker = Binding::new::<ActivePlugins>({
            let identity = identity.clone();
            move || identity.clone()
        });
        let active = scope
            .observe::<ActivePlugins>()
            .map(move |enabled| enabled.iter().any(|plugin| Rc::ptr_eq(plugin, &identity)));
        let content = [active_marker.into()]
            .into_iter()
            .chain(build_content(dependencies)?)
            .collect::<Vec<_>>();
        let initial = if spec.enabled_by_default {
            content.clone()
        } else {
            Vec::new()
        };
        let (body, slot) = scope.slot(initial);
        let record = PluginRecord {
            id: spec.id.clone(),
            title: spec.title.clone(),
            description: spec.description.clone(),
            controller: Rc::new(PluginController {
                active: PluginActivity(active),
                body: slot,
                content,
            }),
        };

        Ok(Instance::new(()).with_children(vec![
            body,
            Binding::new::<Plugins>(move || record.clone()).into(),
        ]))
    })
}
