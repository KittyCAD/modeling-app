//! Representation of KCL memory.
//!
//! Stores `KclValue`s by name using dynamic scoping. Memory does not support addresses or references,
//! so all values must be self-contained. Memory is essentially a map from `String`s to `KclValue`s.
//! `KclValue`s are entirely opaque to this module. Memory is global and there should be only
//! one per execution. It has no explicit support for caching between executions.
//!
//! Memory is mostly immutable (since KCL does not support mutation or reassignment). However, tags
//! may change as code is executed and that mutates memory. Therefore,
//! ProgramMemory supports mutability and does not rely on KCL's (mostly) immutable nature.
//!
//! ProgramMemory is observably monotonic, i.e., it only grows and even when we pop a stack frame the
//! frame, it is retained. We remove some values which we know cannot be referenced, but we
//! should in the future do better garbage collection (of values and envs).
//!
//! ## Concepts
//!
//! There are three main moving parts for ProgramMemory: environments, snapshots, and the call stack. I'll
//! cover environments (and the call stack) first as if snapshots didn't exist, then describe snapshots.
//!
//! An environment is a set of bindings (i.e., a map from names to values). Environments handle
//! both scoping and context switching. A new lexical scope means a new environment. Nesting of scopes
//! means that environments form a tree, which is represented by parent pointers in the environments.
//!
//! Example:
//!
//! ```norun
//! a = 10
//!
//! fn foo() {
//!   b = a
//!   a = 0
//! }
//! ```
//!
//! The body of `foo` has an environment whose parent is the enclosing scope. Variables in the inner
//! scope can hide those in the outer scope (meaning `a` can be redefined in `foo`). Variables in the
//! outer scope are visible from the inner scope. Note that `b` and the new `a` are not visible
//! outside of `foo`.
//!
//! Nesting of environments is independent of the call stack. E.g., when `foo` is called, we push a
//! new stack frame (which is an environment). The caller's env is on the stack and is not referenced
//! by the new environment (i.e., variables in the caller's env are not visible from the callee).
//!
//! Note, however, that if a function is called from it's enclosing scope, then the outer env will
//! be on the call stack and be the parent of the current env. Calling from a different scope will
//! mean the call stack and parent env do not correspond.
//!
//! When a function declaration is interpreted we create a value in memory (in the env in which it
//! is declared) which contains the function's AST and a reference to the env where it is declared.
//! When the function is called, a new environment is created with the saved reference as its parent
//! and used for interpreting the function body. The return value is saved into this env. When the
//! function returns the callee env is popped to resume execution in the caller's env.
//!
//! Now consider extending the above example:
//!
//! Example:
//!
//! ```norun
//! a = 10
//!
//! fn foo() {
//!   b = a
//!   a = 0
//! }
//!
//! c = 2
//! ```
//!
//! `c` should not be visible inside foo and if `a` is modified after the declaration of `foo`, then
//! the earlier value should be the one visible in `foo`, even if `foo` is called after (lexically or
//! temporally) the definition of `c`. (Note that although KCL does not permit mutation, objects
//! can change due to the way tags are implemented).
//!
//! To make this work, when we save a reference to an enclosing scope we take a snapshot of memory at
//! that point and save a reference to that snapshot. When we call a function, the parent of the new
//! callee env is that snapshot, not the current version of the enclosing scope.
//!
//! Entering an inline scope (e.g., the body of an `if` statement) means pushing an env whose parent
//! is the current env. We don't need to snapshot in this case.
//!
//! ## Implementation
//!
//! All environments are kept by the ProgramMemory, their ordering is not important and does not
//! correspond to anything in the program or execution.
//!
//! Pushing and popping stack frames is straightforward. Most get/set/update operations don't touch
//! the call stack other than the current env (updating tags on function return is the exception).
//!
//! Snapshots are maintained within an environment and are always specific to an environment. Snapshots
//! must also have a parent reference (since they are logically a snapshot of all memory). This parent
//! refers to a snapshot within the parent env. When a snapshot is created, we must create a snapshot
//! object for each parent env. When using a snapshot we must check the parent snapshot whenever
//! we check the parent env (and not the current version of the parent env).
//!
//! An environment will have many snapshots, they are kept in time order, and do not reference each
//! other. (The parent of a snapshot is always in another env).
//!
//! A snapshot is created empty (we don't copy memory) and we use a copy-on-write design: when a
//! value in an environment is modified, we copy the old version into the most recent snapshot (note
//! that we never overwrite a value in the snapshot, if a value is modified multiple times, we want
//! to keep the original version, not an intermediate one). Likewise, if we insert a new variable,
//! we put a tombstone value in the snapshot.
//!
//! When we read from the current version of an environment, we simply read from the bindings in the
//! env and ignore the snapshots. When we read from a snapshot, we first check the specific snapshot
//! for the key, then check any newer snapshots, then finally check the env bindings.
//!
//! A minor optimisation is that when creating a snapshot, if the previous one is empty, then
//! we can reuse that rather than creating a new one. Since we only create a snapshot when a function
//! is declared and the function decl is immediately saved into the new snapshot, the empty snapshot
//! optimisation only happens with parent snapshots (though if the env tree is deep this means we
//! can save a lot of snapshots).
//!
//! ## Invariants
//!
//! There's obviously a bunch of invariants in this design, some are kinda obvious, some are limited
//! in scope and are documented inline, here are some others:
//!
//! - The current env and all envs in the call stack are 'just envs', never a snapshot (we could
//!   use just a ref to an env, rather than to a snapshot but this is pretty inconvenient, so just
//!   know that the snapshot ref is always to the current version). Only the parent envs or saved refs
//!   can be refs to snapshots.
//! - We only ever write into the current env, never into any parent envs (though we can read from
//!   both).
//! - Therefore, there is no concept of writing into a snapshot, only reading from one.
//! - The env ref saved with a function decl is always to a snapshot, never to the current version.
//! - If there are no snapshots in an environment and it is no longer in the call stack, then there
//!   are no references from function decls to the env (if it is the parent of an env with extant refs
//!   then there would be snapshots in the child env and that implies there must be a snapshot in the
//!   parent to be the parent of that snapshot).
//! - Since KCL does not have submodules and decls are not visible outside of a nested scope, all
//!   references to variables in other modules must be in the root scope of a module.
//! - Therefore, an active env must either be on the call stack, have snapshots, or be a root env. This
//!   is however a conservative approximation since snapshots may exist even if there are no live
//!   references to an env.

use std::{collections::HashMap, fmt};

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

/// The distinguished name of the return value of a function.
pub(crate) const RETURN_NAME: &str = "__return";

/// KCL memory. There should be only one ProgramMemory for the interpretation of a program (
/// including other modules). Multiple interpretation runs should have fresh instances.
///
/// See module docs.
#[derive(Debug, Clone)]
pub(crate) struct ProgramMemory {
    environments: Vec<Environment>,
    /// Invariant: current_env.1.is_none()
    current_env: EnvironmentRef,
    /// Invariant: forall er in call_stack: er.1.is_none()
    call_stack: Vec<EnvironmentRef>,
    /// Statistics about the memory, should not be used for anything other than meta-info.
    pub(crate) stats: MemoryStats,
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
            environments: vec![Environment::new_root()],
            current_env: EnvironmentRef::root(),
            call_stack: Vec::new(),
            stats: MemoryStats::default(),
        }
    }

    /// Push a new (standard KCL) stack frame on to the call stack.
    ///
    /// `parent` is the environment where the function being called is declared (not the caller's
    /// environment, which is probably `self.current_env`).
    pub fn push_new_env_for_call(&mut self, parent: EnvironmentRef) {
        self.stats.env_count += 1;

        self.call_stack.push(self.current_env);
        let new_env = Environment::new(parent);
        self.current_env = EnvironmentRef(self.environments.len(), SnapshotRef::none());
        self.environments.push(new_env);
    }

    /// Push a stack frame for an inline scope.
    ///
    /// This should be used for blocks but is currently only used for mock execution.
    pub fn push_new_env_for_scope(&mut self) {
        self.stats.env_count += 1;

        // We need to snapshot in case there is a function decl in the new scope.
        let snapshot = self.snapshot();
        self.push_new_env_for_call(snapshot);
    }

    /// Push a new stack frame on to the call stack for callees which should not read or write
    /// from memory.
    ///
    /// This is suitable for calling standard library functions or other functions written in Rust
    /// which will use 'Rust memory' rather than KCL's memory and cannot reach into the wider
    /// environment.
    ///
    /// Trying to read or write from this environment will panic with an index out of bounds.
    pub fn push_new_env_for_rust_call(&mut self) {
        self.call_stack.push(self.current_env);
        // Rust functions shouldn't try to set or access anything in their environment, so don't
        // waste time and space on a new env. Using usize::MAX means we'll get an overflow if we
        // try to access anything rather than a silent error.
        self.current_env = EnvironmentRef(usize::MAX, SnapshotRef::none());
    }

    /// Push a new stack frame on to the call stack with no connection to a parent environment.
    ///
    /// Suitable for executing a separate module.
    pub fn push_new_root_env(&mut self) {
        self.stats.env_count += 1;

        self.call_stack.push(self.current_env);
        let new_env = Environment::new_root();
        self.current_env = EnvironmentRef(self.environments.len(), SnapshotRef::none());
        self.environments.push(new_env);
    }

    /// Pop a frame from the call stack and return a reference to the popped environment. The popped
    /// environment is preserved if it may be referenced (so the returned reference will remain valid).
    ///
    /// The popped environment may be retained completely (if it may be referenced by a function decl
    /// or import) or retained but its contents deleted or completely discarded.
    pub fn pop_env(&mut self) -> EnvironmentRef {
        let old = self.current_env;
        self.current_env = self.call_stack.pop().unwrap();

        if !old.is_rust_env() {
            self.environments[old.index()].compact();

            if self.environments[old.index()].is_empty() {
                if old.index() == self.environments.len() - 1 {
                    self.environments.pop();
                    self.stats.env_gcs += 1;
                } else {
                    self.stats.skipped_env_gcs += 1;
                }
            } else {
                self.stats.preserved_envs += 1;
            }
        }

        old
    }

    /// Pop a frame from the call stack and return a reference to the popped environment. The popped
    /// environment is always preserved.
    pub fn pop_and_preserve_env(&mut self) -> EnvironmentRef {
        let old = self.current_env;
        self.current_env = self.call_stack.pop().unwrap();
        old
    }

    /// Merges the specified environment with the current environment, rewriting any environment refs
    /// taking snapshots into account. Deletes (if possible) or clears the squashed environment.
    pub fn squash_env(&mut self, old: EnvironmentRef) {
        assert!(!old.is_rust_env());

        let mut old_env = if old.index() == self.environments.len() - 1 {
            // Common case and efficient
            self.stats.env_gcs += 1;
            self.environments.pop().unwrap()
        } else {
            // Should basically never happen in normal usage.
            self.stats.skipped_env_gcs += 1;
            std::mem::replace(&mut self.environments[old.index()], Environment::new(self.current_env))
        };

        // Map of any old env refs to the current env.
        let snapshot_map: HashMap<_, _> = old_env
            .snapshot_parents()
            .map(|(s, p)| (EnvironmentRef(old.0, s), (EnvironmentRef(self.current_env.0, p))))
            .collect();

        // Move the variables in the popped env into the current env.
        for (k, v) in old_env.take_bindings() {
            self.environments[self.current_env.index()].insert_or_update(k.clone(), v.map_env_ref(&snapshot_map));
        }
    }

    /// Snapshot the current state of the memory.
    pub fn snapshot(&mut self) -> EnvironmentRef {
        self.stats.snapshot_count += 1;
        let snapshot = env::snapshot(self, self.current_env);
        EnvironmentRef(self.current_env.0, snapshot)
    }

    /// Add a value to the program memory (in the current scope). The value must not already exist.
    pub fn add(&mut self, key: String, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        if self.environments[self.current_env.index()].contains_key(&key) {
            return Err(KclError::ValueAlreadyDefined(KclErrorDetails {
                message: format!("Cannot redefine `{}`", key),
                source_ranges: vec![source_range],
            }));
        }

        self.stats.mutation_count += 1;

        self.environments[self.current_env.index()].insert(key, value);

        Ok(())
    }

    pub fn insert_or_update(&mut self, key: String, value: KclValue) {
        self.stats.mutation_count += 1;
        self.environments[self.current_env.index()].insert_or_update(key, value);
    }

    /// Delete an item from memory.
    ///
    /// Item will be preserved in any snapshots.
    pub fn clear(&mut self, key: String) {
        self.stats.mutation_count += 1;
        self.environments[self.current_env.index()].clear(key);
    }

    #[cfg(test)]
    fn update_with_env(&mut self, key: &str, value: KclValue, env: Option<usize>) {
        self.stats.mutation_count += 1;
        let env = env.unwrap_or(self.current_env.index());
        self.environments[env].insert_or_update(key.to_owned(), value);
    }

    /// Get a value from the program memory.
    /// Return Err if not found.
    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        self.get_from(var, self.current_env, source_range)
    }

    /// Get a key from the first KCL (i.e., non-Rust) stack frame on the call stack.
    pub fn get_from_call_stack(&self, key: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        if !self.current_env.is_rust_env() {
            return self.get(key, source_range);
        }

        for env in self.call_stack.iter().rev() {
            if !env.is_rust_env() {
                return self.get_from(key, *env, source_range);
            }
        }

        unreachable!("It can't be Rust frames all the way down");
    }

    /// Get a value from a specific snapshot of the memory.
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

    /// Iterate over all key/value pairs in the current environment which satisfy the provided
    /// predicate.
    pub fn find_all_in_current_env<'a>(
        &'a self,
        pred: impl Fn(&KclValue) -> bool + 'a,
    ) -> impl Iterator<Item = (&'a String, &'a KclValue)> {
        self.environments[self.current_env.index()].find_all_by(pred)
    }

    /// Walk all values accessible from any environment in the call stack.
    ///
    /// This may include duplicate values or different versions of a value known by the same key,
    /// since an environment may be accessible via multiple paths.
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

// See walk_call_stack.
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
        self.cur_values.as_ref()?;

        // Loop over each frame in the call stack.
        loop {
            // Loop over each environment in the tree of scopes of which the current stack frame is a leaf.
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
                // Loop to skip any non-KCL stack frames.
                loop {
                    self.stack_index -= 1;
                    let env_ref = self.mem.call_stack[self.stack_index];
                    // We'll eventually hit this condition since we can't start executing in Rust.
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

/// An index pointing to an environment at a point in time (either a snapshot or the current version, see the module docs).
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Hash, Eq, ts_rs::TS, JsonSchema)]
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

/// An index pointing to a snapshot within a specific (unspecified) environment.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Hash, Eq, ts_rs::TS, JsonSchema)]
struct SnapshotRef(usize);

impl SnapshotRef {
    /// Represents no snapshot, use the current version of the environment.
    fn none() -> Self {
        Self(0)
    }

    /// `self` represents a snapshot.
    fn is_some(self) -> bool {
        self.0 > 0
    }

    /// `self` represents the current version.
    fn is_none(self) -> bool {
        self.0 == 0
    }

    // Precondition: self.is_some()
    fn index(&self) -> usize {
        // Note that `0` is a distinguished value meaning 'no snapshot', so the reference value
        // is one greater than the index into the list of snapshots.
        self.0 - 1
    }
}

#[derive(Clone, Debug, Default)]
pub(crate) struct MemoryStats {
    // Total number of environments created.
    env_count: usize,
    // Total number of snapshots created.
    snapshot_count: usize,
    // Total number of values inserted or updated.
    mutation_count: usize,
    // The number of envs we delete when popped from the call stack.
    env_gcs: usize,
    // The number of empty envs we can't delete when popped from the call stack.
    skipped_env_gcs: usize,
    // The number of envs we can't delete when popped from the call stack because they may be referenced.
    preserved_envs: usize,
}

// Use a sub-module to protect access to `Environment::bindings` and prevent unexpected mutatation
// of stored values.
mod env {
    use super::*;

    #[derive(Debug, Clone, PartialEq)]
    pub(super) struct Environment {
        bindings: IndexMap<String, KclValue>,
        // invariant: self.parent.is_none() => forall s in self.snapshots: s.parent_snapshot.is_none()
        snapshots: Vec<Snapshot>,
        // An outer scope, if one exists.
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

    #[derive(Debug, Clone, PartialEq)]
    struct Snapshot {
        /// The version of the owning environment's parent environment corresponding to this snapshot.
        parent_snapshot: Option<SnapshotRef>,
        /// CoW'ed data from the environment.
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
        /// Create a new root environment (new program or module)
        pub(super) fn new_root() -> Self {
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

        /// Create a new child environment, parent points to it's surrounding lexical scope.
        pub(super) fn new(parent: EnvironmentRef) -> Self {
            assert!(!parent.is_rust_env());
            Self {
                bindings: IndexMap::new(),
                snapshots: Vec::new(),
                parent: Some(parent),
            }
        }

        // True if the env is empty and not a root env.
        pub(super) fn is_empty(&self) -> bool {
            self.snapshots.is_empty() && self.bindings.is_empty() && self.parent.is_some()
        }

        /// Possibly compress this environment by deleting the memory.
        ///
        /// This method will return without changing anything if the environment may be referenced
        /// (this is a pretty conservative approximation, but if you keep an EnvironmentRef around
        /// in a new way it might be incorrect).
        ///
        /// See module docs for more details.
        pub(super) fn compact(&mut self) {
            // Don't compress if there might be a closure or import referencing us.
            if !self.snapshots.is_empty() || self.parent.is_none() {
                return;
            }

            self.bindings = IndexMap::new();
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

            self.bindings
                .get(key)
                .and_then(|v| match v {
                    KclValue::Tombstone { .. } => None,
                    _ => Some(v),
                })
                .ok_or(self.parent(snapshot))
        }

        /// Find the `EnvironmentRef` of the parent of this environment corresponding to the specified snapshot.
        pub(super) fn parent(&self, snapshot: SnapshotRef) -> Option<EnvironmentRef> {
            if snapshot.is_none() {
                return self.parent;
            }

            match self.snapshots[snapshot.index()].parent_snapshot {
                Some(sr) => Some(EnvironmentRef(self.parent.unwrap().0, sr)),
                None => self.parent,
            }
        }

        /// Iterate over all values in the environment at the specified snapshot.
        pub(super) fn values<'a>(&'a self, snapshot: SnapshotRef) -> Box<dyn Iterator<Item = &'a KclValue> + 'a> {
            if snapshot.is_none() {
                return Box::new(self.bindings.values());
            }

            Box::new(
                self.bindings
                    .iter()
                    .filter_map(move |(k, v)| {
                        (!self.snapshot_contains_key(k, snapshot) && !matches!(v, KclValue::Tombstone { .. }))
                            .then_some(v)
                    })
                    .chain(
                        self.snapshots
                            .iter()
                            .flat_map(|s| s.data.values().filter(|v| !matches!(v, KclValue::Tombstone { .. }))),
                    ),
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

        /// Delete a key/value.
        ///
        /// We want to preserve the snapshot, so we can't just remove the element. We copy the deleted
        /// value to the snapshot and replace the current value with a tombstone.
        pub(super) fn clear(&mut self, key: String) {
            if self.bindings.contains_key(&key) {
                let old = self.bindings.insert(key.clone(), tombstone()).unwrap();
                if let Some(s) = self.snapshots.last_mut() {
                    s.data.insert(key, old);
                }
            }
        }

        /// Was the key contained in this environment at the specified point in time.
        fn snapshot_contains_key(&self, key: &str, snapshot: SnapshotRef) -> bool {
            for i in snapshot.index()..self.snapshots.len() {
                if self.snapshots[i].data.contains_key(key) {
                    return true;
                }
            }
            false
        }

        /// Is the key currently contained in this environment.
        pub(super) fn contains_key(&self, key: &str) -> bool {
            !matches!(self.bindings.get(key), Some(KclValue::Tombstone { .. }) | None)
        }

        /// Iterate over all key/value pairs currently in this environment where the value satisfies
        /// the providied predicate (`f`).
        pub(super) fn find_all_by<'a>(
            &'a self,
            f: impl Fn(&KclValue) -> bool + 'a,
        ) -> impl Iterator<Item = (&'a String, &'a KclValue)> {
            self.bindings
                .iter()
                .filter(move |(_, v)| f(v) && !matches!(v, KclValue::Tombstone { .. }))
        }

        /// Take all bindings from the environment.
        pub(super) fn take_bindings(&mut self) -> impl Iterator<Item = (String, KclValue)> {
            let bindings = std::mem::take(&mut self.bindings);
            bindings
                .into_iter()
                .filter(move |(_, v)| !matches!(v, KclValue::Tombstone { .. }))
        }

        /// Returns an iterator over any snapshots in this environment, returning the ref to the
        /// snapshot and its parent.
        pub(super) fn snapshot_parents(&self) -> impl Iterator<Item = (SnapshotRef, SnapshotRef)> + '_ {
            self.snapshots
                .iter()
                .enumerate()
                .map(|(i, s)| (SnapshotRef(i + 1), s.parent_snapshot.unwrap()))
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

    /// Build a new snapshot of the specified environment at the current moment.
    ///
    /// This is non-trival since we have to build the tree of parent snapshots.
    pub(super) fn snapshot(mem: &mut ProgramMemory, env_ref: EnvironmentRef) -> SnapshotRef {
        let env = &mem.environments[env_ref.index()];
        let parent_snapshot = env.parent.map(|p| snapshot(mem, p));

        let env = &mut mem.environments[env_ref.index()];
        if env.snapshots.is_empty() {
            env.snapshots.push(Snapshot::new(parent_snapshot));
            return SnapshotRef(1);
        }

        let prev_snapshot = env.snapshots.last().unwrap();
        if prev_snapshot.data.is_empty() && prev_snapshot.parent_snapshot == parent_snapshot {
            // If the prev snapshot is empty, reuse it.
            return SnapshotRef(env.snapshots.len());
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
    use crate::execution::kcl_value::NumericType;

    use super::*;

    fn sr() -> SourceRange {
        SourceRange::default()
    }

    fn val(value: i64) -> KclValue {
        KclValue::Number {
            value: value as f64,
            ty: NumericType::count(),
            meta: Vec::new(),
        }
    }

    #[track_caller]
    fn assert_get(mem: &ProgramMemory, key: &str, n: i64) {
        match mem.get(key, sr()).unwrap() {
            KclValue::Number { value, .. } => assert_eq!(*value as i64, n),
            _ => unreachable!(),
        }
    }

    fn expect_small_number(value: &KclValue) -> Option<i64> {
        match value {
            KclValue::Number { value, .. } if value > &0.0 && value < &10.0 => Some(*value as i64),
            _ => None,
        }
    }

    #[track_caller]
    fn assert_get_from(mem: &ProgramMemory, key: &str, n: i64, snapshot: EnvironmentRef) {
        match mem.get_from(key, snapshot, sr()).unwrap() {
            KclValue::Number { value, .. } => assert_eq!(*value as i64, n),
            _ => unreachable!(),
        }
    }

    #[test]
    fn mem_smoke() {
        // Follows test_pattern_transform_function_cannot_access_future_definitions

        let mem = &mut ProgramMemory::new();
        let transform = mem.snapshot();
        mem.add("transform".to_owned(), val(1), sr()).unwrap();
        let layer = mem.snapshot();
        mem.add("layer".to_owned(), val(1), sr()).unwrap();
        mem.add("x".to_owned(), val(1), sr()).unwrap();

        mem.push_new_env_for_call(layer);
        mem.pop_env();

        mem.push_new_env_for_call(transform);
        mem.get("x", sr()).unwrap_err();
        mem.pop_env();
    }

    #[test]
    fn simple_snapshot() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        assert_get(mem, "a", 1);
        mem.add("a".to_owned(), val(2), sr()).unwrap_err();
        assert_get(mem, "a", 1);
        mem.get("b", sr()).unwrap_err();

        let sn = mem.snapshot();
        mem.add("a".to_owned(), val(2), sr()).unwrap_err();
        assert_get(mem, "a", 1);
        mem.add("b".to_owned(), val(3), sr()).unwrap();
        assert_get(mem, "b", 3);
        mem.get_from("b", sn, sr()).unwrap_err();
    }

    #[test]
    fn multiple_snapshot() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();

        let sn1 = mem.snapshot();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        let sn2 = mem.snapshot();
        mem.add("a".to_owned(), val(4), sr()).unwrap_err();
        mem.add("b".to_owned(), val(5), sr()).unwrap_err();
        mem.add("c".to_owned(), val(6), sr()).unwrap();
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
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        mem.add("c".to_owned(), val(5), sr()).unwrap();
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
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        mem.add("c".to_owned(), val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);
        mem.pop_env();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b".to_owned(), val(6), sr()).unwrap();
        mem.add("d".to_owned(), val(7), sr()).unwrap();
        assert_get(mem, "b", 6);
        assert_get(mem, "d", 7);
        mem.get("c", sr()).unwrap_err();
        mem.pop_env();
    }

    #[test]
    fn root_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        mem.push_new_root_env();
        mem.get("b", sr()).unwrap_err();
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        mem.add("c".to_owned(), val(5), sr()).unwrap();
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
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();
        let sn = mem.snapshot();

        mem.push_new_env_for_rust_call();
        mem.push_new_env_for_call(sn);
        assert_get(mem, "b", 3);
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        assert_get(mem, "b", 4);

        mem.pop_env();
        mem.pop_env();
        assert_get(mem, "b", 3);
    }

    #[test]
    fn deep_call_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 3);
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        mem.add("c".to_owned(), val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);

        mem.push_new_env_for_call(mem.current_env);
        assert_get(mem, "b", 4);
        mem.add("b".to_owned(), val(6), sr()).unwrap();
        mem.add("d".to_owned(), val(7), sr()).unwrap();
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
        mem.add("a".to_owned(), val(1), sr()).unwrap();

        let sn = mem.snapshot();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        mem.push_new_env_for_call(sn);
        mem.get("b", sr()).unwrap_err();
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        mem.add("c".to_owned(), val(5), sr()).unwrap();
        assert_get(mem, "b", 4);
        assert_get(mem, "c", 5);

        mem.pop_env();
        // old snapshot still untouched
        mem.get_from("b", sn, sr()).unwrap_err();
    }

    #[test]
    fn snap_env2() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();

        let sn1 = mem.snapshot();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        mem.push_new_env_for_call(mem.current_env);
        let sn2 = mem.snapshot();
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        let sn3 = mem.snapshot();
        assert_get_from(mem, "b", 3, sn2);
        mem.add("c".to_owned(), val(5), sr()).unwrap();
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
    fn snap_env_two_updates() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();

        let sn1 = mem.snapshot();
        mem.add("b".to_owned(), val(3), sr()).unwrap();
        let sn2 = mem.snapshot();

        let callee_env = mem.current_env.0;
        mem.push_new_env_for_call(sn2);
        let sn3 = mem.snapshot();
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        let sn4 = mem.snapshot();
        mem.update_with_env("b", val(6), None);
        mem.update_with_env("b", val(7), Some(callee_env));

        assert_get(mem, "b", 6);
        assert_get_from(mem, "b", 3, sn3);
        assert_get_from(mem, "b", 4, sn4);

        let vals: Vec<_> = mem.walk_call_stack().filter_map(expect_small_number).collect();
        let expected = [6, 1, 3, 1, 7];
        assert_eq!(vals, expected);

        let popped = mem.pop_env();
        assert_get(mem, "b", 7);
        mem.get_from("b", sn1, sr()).unwrap_err();
        assert_get_from(mem, "b", 3, sn2);

        let vals: Vec<_> = mem.walk_call_stack().filter_map(expect_small_number).collect();
        let expected = [1, 7];
        assert_eq!(vals, expected);

        let popped_env = &mem.environments[popped.index()];
        let sp: Vec<_> = popped_env.snapshot_parents().collect();
        assert_eq!(
            sp,
            vec![(SnapshotRef(1), SnapshotRef(2)), (SnapshotRef(2), SnapshotRef(2))]
        );
    }

    #[test]
    fn snap_env_clear() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();

        mem.add("b".to_owned(), val(3), sr()).unwrap();
        let sn = mem.snapshot();

        mem.push_new_env_for_call(sn);
        mem.snapshot();
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        mem.snapshot();
        mem.clear("b".to_owned());
        mem.clear("a".to_owned());

        assert_get(mem, "b", 3);
        assert_get(mem, "a", 1);

        mem.pop_env();
        assert_get(mem, "b", 3);
        assert_get(mem, "a", 1);
    }

    #[test]
    fn snap_env_clear2() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();
        let sn1 = mem.snapshot();
        mem.clear("b".to_owned());
        mem.clear("a".to_owned());
        mem.get("b", SourceRange::default()).unwrap_err();
        mem.get("a", SourceRange::default()).unwrap_err();

        let sn = mem.snapshot();
        mem.push_new_env_for_call(sn);
        mem.add("b".to_owned(), val(4), sr()).unwrap();
        let sn2 = mem.snapshot();
        mem.clear("b".to_owned());
        mem.clear("a".to_owned());
        mem.get("b", SourceRange::default()).unwrap_err();
        mem.get("a", SourceRange::default()).unwrap_err();

        mem.pop_env();
        mem.get("b", SourceRange::default()).unwrap_err();
        mem.get("a", SourceRange::default()).unwrap_err();

        assert_get_from(mem, "a", 1, sn1);
        assert_get_from(mem, "b", 3, sn1);
        mem.get_from("a", sn2, SourceRange::default()).unwrap_err();
        assert_get_from(mem, "b", 4, sn2);
    }

    #[test]
    fn squash_env() {
        let mem = &mut ProgramMemory::new();
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        let sn1 = mem.snapshot();
        mem.push_new_env_for_call(sn1);
        mem.add("b".to_owned(), val(2), sr()).unwrap();
        let sn2 = mem.snapshot();
        mem.add(
            "f".to_owned(),
            KclValue::Function {
                func: None,
                expression: crate::parsing::ast::types::FunctionExpression::dummy(),
                memory: sn2,
                meta: Vec::new(),
            },
            sr(),
        )
        .unwrap();
        let old = mem.pop_and_preserve_env();
        mem.squash_env(old);
        assert_get(mem, "a", 1);
        assert_get(mem, "b", 2);
        match mem.get("f", SourceRange::default()).unwrap() {
            KclValue::Function { memory, .. } if *memory == sn1 => {}
            v => panic!("{v:#?}"),
        }
        assert_eq!(mem.environments.len(), 1);
        assert_eq!(mem.current_env, EnvironmentRef(0, SnapshotRef(0)));
    }
}
