use indexmap::IndexSet;

pub type AhashIndexSet<T> = IndexSet<T, ahash::RandomState>;
