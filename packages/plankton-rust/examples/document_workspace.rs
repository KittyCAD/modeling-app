use std::rc::Rc;

use plankton_rust::{
    Binding, Dependencies, Facet, Factory, HookResult, Instance, PluginSpec, Plugins, Registry,
    Service, Signal, create_plugin, slot,
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

    let outline = create_plugin(
        PluginSpec::new(
            "outline",
            "Outline",
            "Show an outline for the current document",
        ),
        document.dependency("title"),
        |title| {
            let read_title = title.as_ref().clone();
            Ok(vec![
                Binding::new::<Panels>(move || format!("Outline for {}", read_title.get()))
                    .depending_on(&title)
                    .into(),
            ])
        },
    );
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
    let outline = registry
        .get::<Plugins>()
        .into_iter()
        .find(|plugin| plugin.id == "outline")
        .ok_or("expected an installed outline plugin")?;
    let outline = outline.controller;
    outline.toggle(&mut registry)?;
    document.title.set("scene.kcl".into());
    outline.toggle(&mut registry)?;

    drop(subscription);
    registry.dispose()?;
    Ok(())
}
