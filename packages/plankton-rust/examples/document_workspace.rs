use std::rc::Rc;

use plankton_rust::{
    Binding, Dependencies, Extension, Facet, Factory, HookResult, Instance, ReadSignal, Registry,
    RegistryError, ScopedSlot, Service, Signal, slot,
};

struct Panels;

impl Facet for Panels {
    type Input = String;
    type Output = Vec<String>;

    fn combine(inputs: Vec<String>) -> Self::Output {
        inputs
    }
}

struct Document {
    title: Signal<String>,
}

struct ActiveDocument;

impl Service for ActiveDocument {
    type Capability = Document;
}

struct OutlineEnabled;

impl Facet for OutlineEnabled {
    type Input = ();
    type Output = bool;

    fn combine(inputs: Vec<()>) -> bool {
        !inputs.is_empty()
    }
}

struct OutlinePlugin;

impl Service for OutlinePlugin {
    type Capability = OutlineController;
}

struct OutlineController {
    body: ScopedSlot,
    content: Vec<Extension>,
}

impl OutlineController {
    fn toggle(&self, registry: &mut Registry) -> Result<(), RegistryError> {
        let children = if registry.get::<OutlineEnabled>() {
            Vec::new()
        } else {
            self.content.clone()
        };
        self.body.replace(registry, children)
    }
}

fn outline_plugin(document: &Factory<ReadSignal<String>>) -> Factory<()> {
    Factory::keyed(
        "outline plugin",
        document.dependency("title"),
        |title, scope| {
            let read_title = title.as_ref().clone();
            let content = vec![
                Binding::new::<OutlineEnabled>(|| ()).into(),
                Binding::new::<Panels>(move || format!("Outline for {}", read_title.get()))
                    .depending_on(&title)
                    .into(),
            ];
            let (body, handle) = scope.slot(content.clone());
            let controller = OutlineController {
                body: handle,
                content,
            };
            Ok(Instance::new(()).with_children(vec![
                body,
                Binding::provide::<OutlinePlugin>(Rc::new(controller)).into(),
            ]))
        },
    )
}

fn main() -> HookResult {
    let document = Factory::new(Dependencies::none(), |(), _| {
        let document = Rc::new(Document {
            title: Signal::new("sketch.kcl".into()),
        });
        let service = Binding::provide::<ActiveDocument>(document.clone());
        // The editor reads the title. The host edits it through the service.
        Ok(Instance::new(document.title.read_only()).with_children(vec![service.into()]))
    });
    let editor = Factory::new(document.dependency("title"), |title, _| {
        let source = {
            let title = title.as_ref().clone();
            move || title.get()
        };
        let panel = Binding::new::<Panels>(source).depending_on(&title);
        Ok(Instance::new(()).with_children(vec![panel.into()]))
    });

    let outline = outline_plugin(&document);
    let sidebar = slot(vec![Binding::new::<Panels>(|| "help".into()).into()]);
    let mut registry = Registry::new();
    registry.configure(vec![editor.into(), sidebar.clone().into(), outline.into()])?;

    let panels = registry.observe::<Panels>();
    println!("Initial panels: {:?}", panels.get()?);
    let subscription = panels.subscribe(|panels| println!("Panels changed: {panels:?}"))?;
    let document = registry.required::<ActiveDocument>()?;
    document.title.set("assembly.kcl".into());
    registry.replace(
        &sidebar,
        vec![Binding::new::<Panels>(|| "search".into()).into()],
    )?;

    // The same controller stays available while its slot is empty.
    let outline = registry.required::<OutlinePlugin>()?;
    outline.toggle(&mut registry)?;
    document.title.set("scene.kcl".into());
    outline.toggle(&mut registry)?;

    drop(subscription);
    registry.dispose()?;
    Ok(())
}
