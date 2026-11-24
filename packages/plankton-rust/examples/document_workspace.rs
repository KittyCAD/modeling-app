use std::cell::RefCell;

use plankton_rust::{Binding, Dependencies, Facet, Factory, HookResult, Instance, Registry, slot};

struct Panels;

impl Facet for Panels {
    type Input = String;
    type Output = Vec<String>;

    fn combine(inputs: Vec<String>) -> Self::Output {
        inputs
    }
}

struct Document {
    title: RefCell<String>,
}

fn main() -> HookResult {
    let document = Factory::new(Dependencies::none(), |(), _| {
        Ok(Instance::new(Document {
            title: RefCell::new("sketch.kcl".into()),
        }))
    });
    let editor = Factory::new(document.dependency("document"), |document, scope| {
        let panels = scope.observe::<Panels>();
        Ok(Instance::new(())
            .with_children(vec![
                Binding::new::<Panels>(move || document.title.borrow().clone()).into(),
            ])
            .on_start(move || {
                println!("After startup: {:?}", panels.get()?);
                Ok(())
            }))
    });

    let sidebar = slot(vec![Binding::new::<Panels>(|| "outline".into()).into()]);
    let mut registry = Registry::new();
    registry.configure(vec![editor.into(), sidebar.clone().into()])?;

    let panels = registry.observe::<Panels>();
    registry.replace(
        &sidebar,
        vec![Binding::new::<Panels>(|| "search".into()).into()],
    )?;
    println!("After replacement: {:?}", panels.get()?);

    registry.dispose()?;
    Ok(())
}
