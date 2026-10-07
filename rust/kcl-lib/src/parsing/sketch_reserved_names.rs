use ahash::AHashSet;
use lazy_static::lazy_static;

lazy_static! {
    /// These names are reserved only in sketch blocks.
    pub(crate) static ref SKETCH_BLOCK_RESERVED_WORDS: AHashSet<&'static str> = {
        let mut set = AHashSet::default();
        set.insert("construction");
        set.insert("dependencies");
        set.insert("exports");
        set.insert("id");
        set.insert("location");
        set.insert("meta");
        set.insert("module");
        set.insert("on");
        set.insert("ORIGIN");
        set.insert("porcelain");
        set.insert("surface");
        set.insert("tags");
        set.insert("worldCoordinates");
        set.insert("zoo");

        set
    };
}
