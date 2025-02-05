//! Representation of KCL memory.
//!
//! Stores `KclValue`s by name using dynamic scoping (i.e., functions as both KCL's runtime memory
//! and name resolution). Memory does not support addresses or references, so all values must be
//! self-contained.
//!
//! Memory is mostly immutable (or at least monotonic; since KCL does not support mutation or
//! reassignment). However, tags may change as code is executed and that mutates tag values in
//! memory and the records of tags in the representation of geometry.
//!
//! TODO document snapshots
//! functions always ref a snapshot

use std::fmt;

use anyhow::Result;
use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::{KclValue, Metadata},
    source_range::SourceRange,
};
use env::Environment;

pub(crate) const RETURN_NAME: &str = "__return";

#[derive(Debug, Clone, Deserialize, Serialize, ts_rs::TS, JsonSchema)]
#[ts(export)]
#[serde(rename_all = "camelCase")]
pub struct ProgramMemory {
    environments: Vec<Environment>,
    /// Invariant: current_env.1.is_none()
    current_env: EnvironmentRef,
    /// Invariant: forall er in call_stack: er.1.is_none()
    call_stack: Vec<EnvironmentRef>,
    #[allow(dead_code)]
    #[serde(skip)]
    stats: MemoryStats,
}

// Intended for debugging. Do not rely on this output in any way!
impl fmt::Display for ProgramMemory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let envs: Vec<String> = self
            .environments
            .iter()
            .enumerate()
            .map(|(i, env)| format!("{i}: {env}"))
            .collect();
        let stack: Vec<String> = self
            .call_stack
            .iter()
            .chain(Some(&self.current_env))
            .map(|e| format!("EnvRef({}, {})", e.0, e.1 .0))
            .collect();
        write!(
            f,
            "ProgramMemory\nenvs:\n{}\nstack:\n  {}",
            envs.join("\n"),
            stack.join("\n  ")
        )
    }
}

impl ProgramMemory {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Self {
        Self {
            environments: vec![Environment::root()],
            current_env: EnvironmentRef::root(),
            call_stack: Vec::new(),
            stats: MemoryStats::default(),
        }
    }

    pub fn push_new_env_for_call(&mut self, parent: EnvironmentRef) {
        self.stats.env_count += 1;

        self.call_stack.push(self.current_env);
        let new_env = Environment::new(parent);
        self.current_env = EnvironmentRef(self.environments.len(), SnapshotRef::none());
        self.environments.push(new_env);
    }

    pub fn push_new_env_for_rust_call(&mut self) {
        self.call_stack.push(self.current_env);
        // Rust functions shouldn't try to set or access anything in their environment, so don't
        // waste time and space on a new env. Using usize::MAX means we'll get an overflow if we
        // try to acceess anything rather than a silent error.
        self.current_env = EnvironmentRef(usize::MAX, SnapshotRef::none());
    }

    pub fn push_new_root_env(&mut self) {
        self.stats.env_count += 1;

        self.call_stack.push(self.current_env);
        let new_env = Environment::root();
        self.current_env = EnvironmentRef(self.environments.len(), SnapshotRef::none());
        self.environments.push(new_env);
    }

    pub fn pop_env(&mut self) -> EnvironmentRef {
        let old = self.current_env;
        self.current_env = self.call_stack.pop().unwrap();

        if !old.is_rust_env() {
            self.environments[old.index()].compress();
        }

        old
    }

    /// Snapshot the current state of the memory.
    pub fn snapshot(&mut self) -> EnvironmentRef {
        self.stats.snapshot_count += 1;
        let snapshot = env::snapshot(self, self.current_env);
        EnvironmentRef(self.current_env.0, snapshot)
    }

    /// Add to the program memory in the current scope.
    pub fn add(&mut self, key: &str, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        if self.environments[self.current_env.index()].contains_key(key) {
            return Err(KclError::ValueAlreadyDefined(KclErrorDetails {
                message: format!("Cannot redefine `{}`", key),
                source_ranges: vec![source_range],
            }));
        }

        self.environments[self.current_env.index()].insert(key.to_owned(), value);

        Ok(())
    }

    pub fn insert_or_update(&mut self, key: String, value: KclValue) {
        self.environments[self.current_env.index()].insert_or_update(key.to_owned(), value);
    }

    #[cfg(test)]
    fn update_with_env(&mut self, key: &str, value: KclValue, env: Option<usize>) {
        let env = env.unwrap_or(self.current_env.index());
        self.environments[env].insert_or_update(key.to_owned(), value);
    }

    /// Get a value from the program memory.
    /// Return Err if not found.
    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        self.get_from(var, self.current_env, source_range)
    }

    pub fn get_from(
        &self,
        var: &str,
        mut env_ref: EnvironmentRef,
        source_range: SourceRange,
    ) -> Result<&KclValue, KclError> {
        loop {
            let env = &self.environments[env_ref.index()];
            env_ref = match env.get(var, env_ref.1) {
                Ok(item) => return Ok(item),
                Err(Some(parent)) => parent,
                Err(None) => break,
            };
        }

        Err(KclError::UndefinedValue(KclErrorDetails {
            message: format!("memory item key `{}` is not defined", var),
            source_ranges: vec![source_range],
        }))
    }

    pub fn find_all_in_current_env<'a>(
        &'a self,
        f: impl Fn(&KclValue) -> bool + 'a,
    ) -> impl Iterator<Item = (&'a String, &'a KclValue)> {
        self.environments[self.current_env.index()].find_all_by(f)
    }

    pub fn walk_call_stack(&self) -> impl Iterator<Item = &KclValue> {
        let mut cur_env = self.current_env;
        let mut stack_index = self.call_stack.len();
        while cur_env.is_rust_env() {
            stack_index -= 1;
            cur_env = self.call_stack[stack_index];
        }

        let mut result = CallStackIterator {
            cur_env,
            cur_values: None,
            stack_index,
            mem: self,
        };
        result.init_iter();
        result
    }
}

struct CallStackIterator<'a> {
    mem: &'a ProgramMemory,
    cur_env: EnvironmentRef,
    cur_values: Option<Box<dyn Iterator<Item = &'a KclValue> + 'a>>,
    stack_index: usize,
}

impl CallStackIterator<'_> {
    fn init_iter(&mut self) {
        self.cur_values = Some(self.mem.environments[self.cur_env.index()].values(self.cur_env.1));
    }
}

impl<'a> Iterator for CallStackIterator<'a> {
    type Item = &'a KclValue;

    fn next(&mut self) -> Option<Self::Item> {
        if self.cur_values.is_none() {
            return None;
        }

        loop {
            loop {
                // `unwrap` is OK since we check for None at the start of the function, and if we update
                // cur_values then it must be to Some(..).
                let next = self.cur_values.as_mut().unwrap().next();
                if next.is_some() {
                    return next;
                }

                if let Some(env_ref) = self.mem.environments[self.cur_env.index()].parent(self.cur_env.1) {
                    self.cur_env = env_ref;
                    self.init_iter();
                } else {
                    break;
                }
            }

            if self.stack_index > 0 {
                loop {
                    self.stack_index -= 1;
                    let env_ref = self.mem.call_stack[self.stack_index];
                    // We'll eventually hit this condtion since we can't start executing in Rust.
                    if !env_ref.is_rust_env() {
                        self.cur_env = env_ref;
                        self.init_iter();
                        break;
                    }
                }
            } else {
                break;
            }
        }

        self.cur_values = None;
        None
    }
}

#[cfg(test)]
impl PartialEq for ProgramMemory {
    fn eq(&self, other: &Self) -> bool {
        self.environments == other.environments && self.current_env == other.current_env
    }
}

/// An index pointing to an environment.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Hash, ts_rs::TS, JsonSchema)]
pub struct EnvironmentRef(usize, SnapshotRef);

impl EnvironmentRef {
    fn root() -> Self {
        Self(0, SnapshotRef::none())
    }

    fn index(&self) -> usize {
        self.0
    }

    fn is_rust_env(&self) -> bool {
        self.0 == usize::MAX
    }
}

#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Hash, ts_rs::TS, JsonSchema)]
pub struct SnapshotRef(usize);

impl SnapshotRef {
    fn none() -> Self {
        Self(0)
    }

    fn is_some(self) -> bool {
        self.0 > 0
    }

    fn is_none(self) -> bool {
        self.0 == 0
    }

    // Precondition: self.is_some()
    fn index(&self) -> usize {
        self.0 - 1
    }
}

#[derive(Clone, Debug, Default)]
struct MemoryStats {
    env_count: usize,
    snapshot_count: usize,
}

// Use a sub-module to protect access to `Environment::bindings` and prevent unexpected mutatation
// of stored values.
mod env {
    use super::*;

    #[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
    pub(super) struct Environment {
        bindings: IndexMap<String, KclValue>,
        // invariant: self.parent.is_none() => forall s in self.snapshots: s.parent_snapshot.is_none()
        snapshots: Vec<Snapshot>,
        parent: Option<EnvironmentRef>,
    }

    impl fmt::Display for Environment {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            let parent = self
                .parent
                .map(|e| format!("EnvRef({}, {})", e.0, e.1 .0))
                .unwrap_or("_".to_owned());
            let data: Vec<String> = self
                .bindings
                .iter()
                .map(|(k, v)| format!("{k}: {}", v.human_friendly_type()))
                .collect();
            let snapshots: Vec<String> = self.snapshots.iter().map(|s| s.to_string()).collect();
            write!(
                f,
                "Env {{\n  parent: {parent},\n  bindings:\n    {},\n  snapshots:\n    {}\n}}",
                data.join("\n    "),
                snapshots.join("\n    ")
            )
        }
    }

    #[derive(Debug, Clone, Deserialize, Serialize, PartialEq, ts_rs::TS, JsonSchema)]
    struct Snapshot {
        parent_snapshot: Option<SnapshotRef>,
        data: IndexMap<String, KclValue>,
    }

    impl fmt::Display for Snapshot {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            let parent = self.parent_snapshot.map(|s| s.0.to_string()).unwrap_or("_".to_owned());
            let data: Vec<String> = self
                .data
                .iter()
                .map(|(k, v)| format!("{k}: {}", v.human_friendly_type()))
                .collect();
            write!(
                f,
                "Snapshot {{\n      parent: {parent},\n      data: {},\n    }}",
                data.join("\n        ")
            )
        }
    }

    impl Environment {
        pub(super) fn root() -> Self {
            const NO_META: Vec<Metadata> = Vec::new();

            Self {
                // Prelude
                bindings: IndexMap::from([
                    ("ZERO".to_string(), KclValue::from_number(0.0, NO_META)),
                    ("QUARTER_TURN".to_string(), KclValue::from_number(90.0, NO_META)),
                    ("HALF_TURN".to_string(), KclValue::from_number(180.0, NO_META)),
                    ("THREE_QUARTER_TURN".to_string(), KclValue::from_number(270.0, NO_META)),
                ]),
                snapshots: Vec::new(),
                parent: None,
            }
        }

        pub(super) fn new(parent: EnvironmentRef) -> Self {
            Self {
                bindings: IndexMap::new(),
                snapshots: Vec::new(),
                parent: Some(parent),
            }
        }

        /// Possibly compress this environment by deleting all memory except the return value.
        /// 
        /// This method will return without changing anything if the environment may be referenced
        /// (this is a pretty conservative approximation, but if you keep an EnvironmentRef around
        /// in a new way it might be incorrect).
        ///
        /// See module docs for more details.
        pub(super) fn compress(&mut self) {
            // Don't compress if there might be a closure or import referencing us.
            if !self.snapshots.is_empty() || self.parent.is_none() {
                return;
            }

            let ret_value = self.bindings.get(RETURN_NAME).cloned();
            self.bindings = IndexMap::new();
            if let Some(ret_value) = ret_value {
                self.bindings.insert(RETURN_NAME.to_owned(), ret_value);
            }
        }

        pub(super) fn get(&self, key: &str, snapshot: SnapshotRef) -> Result<&KclValue, Option<EnvironmentRef>> {
            if snapshot.is_some() {
                for i in snapshot.index()..self.snapshots.len() {
                    match self.snapshots[i].data.get(key) {
                        Some(KclValue::Tombstone { .. }) => return Err(self.parent(snapshot)),
                        Some(v) => return Ok(v),
                        None => {}
                    }
                }
            }

            self.bindings.get(key).ok_or(self.parent(snapshot))
        }

        pub(super) fn parent(&self, snapshot: SnapshotRef) -> Option<EnvironmentRef> {
            if snapshot.is_none() {
                return self.parent;
            }

            match self.snapshots[snapshot.index()].parent_snapshot {
                Some(sr) => Some(EnvironmentRef(self.parent.unwrap().0, sr)),
                None => self.parent,
            }
        }

        pub(super) fn values<'a>(&'a self, snapshot: SnapshotRef) -> Box<dyn Iterator<Item = &'a KclValue> + 'a> {
            if snapshot.is_none() {
                return Box::new(self.bindings.values());
            }

            Box::new(
                self.bindings
                    .iter()
                    .filter_map(move |(k, v)| (!self.snapshot_contains_key(k, snapshot)).then_some(v))
                    .chain(self.snapshots.iter().flat_map(|s| {
                        s.data
                            .values()
                            .filter_map(|v| (!matches!(v, KclValue::Tombstone { .. })).then_some(v))
                    })),
            )
        }

        /// Pure insert, panics if `key` is already in this environment.
        ///
        /// Precondition: !self.contains_key(key)
        pub(super) fn insert(&mut self, key: String, value: KclValue) {
            debug_assert!(!self.bindings.contains_key(&key));
            if let Some(s) = self.snapshots.last_mut() {
                s.data.insert(key.clone(), tombstone());
            }
            self.bindings.insert(key, value);
        }

        pub(super) fn insert_or_update(&mut self, key: String, value: KclValue) {
            if let Some(s) = self.snapshots.last_mut() {
                if !s.data.contains_key(&key) {
                    let old_value = self.bindings.get(&key).cloned().unwrap_or_else(tombstone);
                    s.data.insert(key.clone(), old_value);
                }
            }
            self.bindings.insert(key, value);
        }

        fn snapshot_contains_key(&self, key: &str, snapshot: SnapshotRef) -> bool {
            for i in snapshot.index()..self.snapshots.len() {
                if self.snapshots[i].data.contains_key(key) {
                    return true;
                }
            }
            return false;
        }

        pub(super) fn contains_key(&self, key: &str) -> bool {
            self.bindings.contains_key(key)
        }

        pub(super) fn find_all_by<'a>(
            &'a self,
            f: impl Fn(&KclValue) -> bool + 'a,
        ) -> impl Iterator<Item = (&'a String, &'a KclValue)> {
            self.bindings.iter().filter(move |(_, v)| f(v))
        }
    }

    impl Snapshot {
        fn new(parent_snapshot: Option<SnapshotRef>) -> Self {
            Snapshot {
                parent_snapshot,
                data: IndexMap::new(),
            }
        }
    }

    pub(super) fn snapshot(mem: &mut ProgramMemory, env_ref: EnvironmentRef) -> SnapshotRef {
        let env = &mem.environments[env_ref.index()];
        let parent = env.parent;
        let parent_snapshot = parent.map(|p| snapshot(mem, p));

        let env = &mut mem.environments[env_ref.index()];
        if env.snapshots.is_empty() {
            env.snapshots.push(Snapshot::new(parent_snapshot));
            return SnapshotRef(1);
        }

        env.snapshots.push(Snapshot::new(parent_snapshot));
        SnapshotRef(env.snapshots.len())
    }

    fn tombstone() -> KclValue {
        KclValue::Tombstone {
            value: (),
            meta: Vec::new(),
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;

    fn sr() -> SourceRange {
        SourceRange::default()
    }

    fn val(value: i64) -> KclValue {
        KclValue::Int {
            value,
            meta: Vec::new(),
        }
    }

    #[track_caller]
    fn assert_get(mem: &ProgramMemory, key: &str, n: i64) {
        match mem.get(key, sr()).unwrap() {
            KclValue::Int { value, .. } => assert_eq!(*value, n),
            _ => unreachable!(),
        }
    }

    fn expect_int(value: &KclValue) -> Option<i64> {
        match value {
            KclValue::Int { value, .. } => Some(*value),
            _ => None,
        }
    }

    #[track_caller]
    fn assert_get_from(mem: &ProgramMemory, key: &str, n: i64, snapshot: EnvironmentRef) {
        match mem.get_from(key, snapshot, sr()).unwrap() {
            KclValue::Int { value, .. } => assert_eq!(*value, n),
            _ => unreachable!(),
        }
    }

    #[test]
    fn simple_snapshot() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();
        assert_get(mem, "a", 1);
        mem.add("a", val(2), sr()).unwrap_err();
        assert_get(mem, "a", 1);
        mem.get("b", sr()).unwrap_err();

        let sn = mem.snapshot();
        mem.add("a", val(2), sr()).unwrap_err();
        assert_get(mem, "a", 1);
        mem.add("b", val(3), sr()).unwrap();
        assert_get(mem, "b", 3);
        mem.get_from("b", sn, sr()).unwrap_err();
    }

    #[test]
    fn multiple_snapshot() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();

        let sn1 = mem.snapshot();
        mem.add("b", val(3), sr()).unwrap();

        let sn2 = mem.snapshot();
        mem.add("a", val(4), sr()).unwrap_err();
        mem.add("b", val(5), sr()).unwrap_err();
        mem.add("c", val(6), sr()).unwrap();
        assert_get(mem, "a", 1);
        assert_get(mem, "b", 3);
        assert_get(mem, "c", 6);
        assert_get_from(mem, "a", 1, sn1);
        mem.get_from("b", sn1, sr()).unwrap_err();
        mem.get_from("c", sn1, sr()).unwrap_err();
        assert_get_from(mem, "a", 1, sn2);
        assert_get_from(mem, "b", 3, sn2);
        mem.get_from("c", sn2, sr()).unwrap_err();
    }

    #[test]
    fn simple_call_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();
        mem.add("b", val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b", val(4), sr()).unwrap();
        mem.add("c", val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);
        // Preserve the callee stack frame
        mem.snapshot();

        let callee = mem.pop_env();
        assert_get(mem, "b", 3);
        mem.get("c", sr()).unwrap_err();

        // callee stack frame is preserved
        assert_get_from(mem, "b", 4, callee);
        assert_get_from(mem, "c", 5, callee);
    }

    #[test]
    fn multiple_call_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();
        mem.add("b", val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b", val(4), sr()).unwrap();
        mem.add("c", val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);
        mem.pop_env();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b", val(6), sr()).unwrap();
        mem.add("d", val(7), sr()).unwrap();
        assert_get(mem, "b", 6);
        assert_get(mem, "d", 7);
        mem.get("c", sr()).unwrap_err();
        mem.pop_env();
    }

    #[test]
    fn root_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();
        mem.add("b", val(3), sr()).unwrap();

        mem.push_new_root_env();
        mem.get("b", sr()).unwrap_err();
        mem.add("b", val(4), sr()).unwrap();
        mem.add("c", val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);

        let callee = mem.pop_env();
        assert_get(mem, "b", 3);
        mem.get("c", sr()).unwrap_err();

        // callee stack frame is preserved
        assert_get_from(mem, "b", 4, callee);
        assert_get_from(mem, "c", 5, callee);
    }

    #[test]
    fn rust_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();
        mem.add("b", val(3), sr()).unwrap();
        let sn = mem.snapshot();

        mem.push_new_env_for_rust_call();
        mem.push_new_env_for_call(sn);
        assert_get(mem, "b", 3);
        mem.add("b", val(4), sr()).unwrap();
        assert_get(mem, "b", 4);

        mem.pop_env();
        mem.pop_env();
        assert_get(mem, "b", 3);
    }

    #[test]
    fn deep_call_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();
        mem.add("b", val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b", val(4), sr()).unwrap();
        mem.add("c", val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 4);
        mem.add("b", val(6), sr()).unwrap();
        mem.add("d", val(7), sr()).unwrap();
        assert_get(mem, "b", 6);
        assert_get(mem, "c", 5);
        assert_get(mem, "d", 7);

        mem.pop_env();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);
        mem.get("d", sr()).unwrap_err();

        mem.pop_env();
        assert_get(mem, "b", 3);
        mem.get("c", sr()).unwrap_err();
        mem.get("d", sr()).unwrap_err();
    }

    #[test]
    fn snap_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();

        let sn = mem.snapshot();
        mem.add("b", val(3), sr()).unwrap();

        mem.push_new_env_for_call(sn);
        mem.get("b", sr()).unwrap_err();
        mem.add("b", val(4), sr()).unwrap();
        mem.add("c", val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);

        mem.pop_env();
        // old snapshot still untouched
        mem.get_from("b", sn, sr()).unwrap_err();
    }

    #[test]
    fn snap_env_2() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();

        let sn1 = mem.snapshot();
        mem.add("b", val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        let sn2 = mem.snapshot();
        mem.add("b", val(4), sr()).unwrap();
        let sn3 = mem.snapshot();
        assert_get_from(mem, "b", 3, sn2);
        mem.add("c", val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);

        mem.pop_env();
        // old snapshots still untouched
        mem.get_from("b", sn1, sr()).unwrap_err();
        assert_get_from(mem, "b", 3, sn2);
        mem.get_from("c", sn2, sr()).unwrap_err();
        assert_get_from(mem, "b", 4, sn3);
        mem.get_from("c", sn3, sr()).unwrap_err();
    }

    #[test]
    fn snap_env_2_updates() {
        let mem = &mut ProgramMemory::new();
        mem.add("a", val(1), sr()).unwrap();

        let sn1 = mem.snapshot();
        mem.add("b", val(3), sr()).unwrap();
        let sn2 = mem.snapshot();

        let callee_env = mem.current_env.0;
        mem.push_new_env_for_call(sn2);
        let sn3 = mem.snapshot();
        mem.add("b", val(4), sr()).unwrap();
        let sn4 = mem.snapshot();
        mem.update_with_env("b", val(6), None);
        mem.update_with_env("b", val(7), Some(callee_env));

        assert_get(mem, "b", 6);
        assert_get_from(mem, "b", 3, sn3);
        assert_get_from(mem, "b", 4, sn4);

        let vals: Vec<_> = mem.walk_call_stack().filter_map(expect_int).collect();
        let expected = [6, 1, 3, 1, 7];
        assert_eq!(vals, expected);

        mem.pop_env();
        assert_get(mem, "b", 7);
        mem.get_from("b", sn1, sr()).unwrap_err();
        assert_get_from(mem, "b", 3, sn2);

        let vals: Vec<_> = mem.walk_call_stack().filter_map(expect_int).collect();
        let expected = [1, 7];
        assert_eq!(vals, expected);
    }

    #[test]
    fn mem_smoke() {
        // Follows test_pattern_transform_function_cannot_access_future_definitions

        let mem = &mut ProgramMemory::new();
        let transform = mem.snapshot();
        mem.add("transform", val(1), sr()).unwrap();
        let layer = mem.snapshot();
        mem.add("layer", val(1), sr()).unwrap();
        mem.add("x", val(1), sr()).unwrap();

        mem.push_new_env_for_call(layer);
        mem.pop_env();

        mem.push_new_env_for_call(transform);
        mem.get("x", sr()).unwrap_err();
        mem.pop_env();
    }
}
