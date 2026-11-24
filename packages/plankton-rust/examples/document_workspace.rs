use std::rc::Rc;

use plankton_rust::{
    Binding, Dependencies, Facet, Factory, HookResult, Instance, Registry, Resolution, Service,
    Signal, slot,
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
        // Export the signal for constructor injection and provide the document
        // service so the host can edit it after publication.
        Ok(Instance::new(document.title.clone()).with_children(vec![service.into()]))
    });
    let editor = Factory::new(document.dependency("title"), |title, _| {
        let source = {
            let title = title.clone();
            move || title.get()
        };
        let panel = Binding::new::<Panels>(source).depending_on(&title);
        Ok(Instance::new(()).with_children(vec![panel.into()]))
    });

    let sidebar = slot(vec![Binding::new::<Panels>(|| "outline".into()).into()]);
    let mut registry = Registry::new();
    registry.configure(vec![editor.into(), sidebar.clone().into()])?;

    let panels = registry.observe::<Panels>();
    println!("Initial panels: {:?}", panels.get()?);
    let subscription = panels.subscribe(|panels| println!("Panels changed: {panels:?}"))?;
    let Resolution::Ready(document) = registry.resolve::<ActiveDocument>() else {
        return Err("expected one active document".into());
    };
    document.title.set("assembly.kcl".into());
    registry.replace(
        &sidebar,
        vec![Binding::new::<Panels>(|| "search".into()).into()],
    )?;

    drop(subscription);
    registry.dispose()?;
    Ok(())
}
