use std::path::Path;

fn accepts(path: &Path, source: String) -> datatest_stable::Result<()> {
    assert!(kcl_grammar::recognizes_settings(&source), "rejected {}", path.display());
    Ok(())
}

fn rejects(path: &Path, source: String) -> datatest_stable::Result<()> {
    assert!(
        !kcl_grammar::recognizes_settings(&source),
        "accepted {}",
        path.display()
    );
    Ok(())
}

datatest_stable::harness! {
    {
        test = accepts,
        root = "corpus/success/settings",
        pattern = r"\.kcl$",
    },
    {
        test = rejects,
        root = "corpus/failures/settings",
        pattern = r"\.kcl$",
    },
}
