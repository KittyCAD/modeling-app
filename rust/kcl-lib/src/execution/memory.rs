//! Representation of KCL memory.
//!
//! Stores `KclValue`s by name using dynamic scoping. Memory does not support addresses or references,
//! so all values must be self-contained. Memory is essentially a map from `String`s to `KclValue`s.
//! `KclValue`s are entirely opaque to this module. Memory is global and there should be only
//! one per execution. It has no explicit support for caching between executions.
//!
//! Memory is mostly immutable (since KCL does not support mutation or reassignment). However, tags
//! may change as code is executed and that mutates memory. Therefore to some extent,
//! ProgramMemory supports mutability and does not rely on KCL's (mostly) immutable nature.
//!
//! ProgramMemory is observably monotonic, i.e., it only grows and even when we pop a stack frame,
//! the frame is retained unless we can prove it is unreferenced. We remove some values which we
//! know cannot be referenced, but we should in the future do better garbage collection (of values
//! and envs).
//!
//! ## Concepts
//!
//! There are three main moving parts for ProgramMemory: environments, epochs, and stacks. I'll
//! cover environments (and the call stack) first as if epochs didn't exist, then describe epochs.
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
//! We use a new call stack for each module. When interpreting a module we start a new call stack
//! with a new environment (though see below about std). Names imported from one module into another
//! point into the envs from the exporting module's call stack (though once the module has been
//! interpreted, those envs won't be on it's call stack any longer). A call stack is represented by
//! a `Stack` object which references the global `ProgramMemory` object. Environments are stored in
//! the global memory and the call stack is a stack of references. (See below on concurrent access
//! using `Stack`s).
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
//! To make this work, we have the concept of an epoch. An epoch is a simple, global, monotonic counter
//! which is incremented at any significant moment in execution (we use the term snapshot). When a
//! value is saved in memory we also save the epoch at which it was stored.
//!
//! When we save a reference to an enclosing scope we take a snapshot and save that epoch as part of
//! the reference. When we call a function, we use the epoch when it was defined to look up variables,
//! ignoring any variables which have a creation time later than the saved epoch.
//!
//! Because the callee could create new variables (with a creation time of the current epoch) which
//! the callee should be able to read, we can't simply check the epoch with the callees (and we'd need
//! to maintain a stack of callee epochs for further calls, etc.). Instead a stack frame consists of
//! a reference to an environment and an epoch at which reads should take place. When we call a function
//! this creates a new env using the current epoch, and it's parent env (which is the enclosing scope
//! of the function declaration) includes the epoch at which the function was declared.
//!
//! So far, this handles variables created after a function is declared, but does not handle mutation.
//! Mutation must be handled internally in values, see for example `TagIdentifier`. It is suggested
//! that objects rely on epochs for this. Since epochs are linked to the stack frame, only objects in
//! the current stack frame should be mutated.
//!
//! ### Std
//!
//! The standard library is implicitly imported into every module (unless it explicitly opts out).
//! So that these implicitly imported names can be overridden, we want to import these names into a
//! scope outside the implicitly importing module. Furthermore, for efficiency we'd like to share
//! these imported names between all modules (because std is large and every module imports all
//! those names). This is safe to do because everything in std is fully immutable.
//!
//! To make this work, every env has the std import (prelude) env as its root ancestor. So when an
//! env is marked as a root env, it may still have the prelude env as its parent.
//!
//! ## Implementation
//!
//! All environments are kept by the ProgramMemory, their ordering is not important and does not
//! correspond to anything in the program or execution.
//!
//! Pushing and popping stack frames is straightforward. Most get/set/update operations don't touch
//! the call stack other than the current env (updating tags on function return is the exception).
//!
//! ## Invariants
//!
//! There's obviously a bunch of invariants in this design, some are kinda obvious, some are limited
//! in scope and are documented inline, here are some others:
//!
//! - We only ever write into the current env, never into any parent envs (though we can read from
//!   both).
//! - We only ever write (or mutate) at the most recent epoch, never at an older one.
//! - The env ref saved with a function decl is always to an historic epoch, never to the current one.
//! - Since KCL does not have submodules and decls are not visible outside of a nested scope, all
//!   references to variables in other modules must be in the root scope of a module.
//!
//! ## Concurrency and thread-safety
//!
//! `ProgramMemory` is a global singleton (technically one per program execution, if we handled multiple
//! projects in a single interpreter process we'd need multiple `ProgramMemory`s, but that is currently
//! not possible). `ProgramMemory` could be moved between threads, but there shouldn't be any need
//! to do so. It can safely be referenced and accessed from multiple threads, but there are rules for
//! doing so.
//!
//! `ProgramMemory` is mostly accessed via a `Stack` object, avoid accessing `ProgramMemory` directly
//! where possible. `Stack`s can safely be moved to other threads and can access `ProgramMemory`
//! from a different thread. There can be multiple `Stack`s on different threads or the same thread
//! (either operating sequentially or using async tasks).
//!
//! The key requirement for users is that names from a `Stack` should never be exposed until the
//! `Stack` itself is no longer needed. I.e., when interpreting a module, you would use a new `Stack`
//! for the module and no other module can reference anything in the module until interpretation of
//! it is complete (and the `Stack` object has been dropped).
//!
//! Using most of the `Stack` API is easy - you don't need to worry about thread safety and can treat
//! it just like a self-contained object (though see the docs on `restore_env` and `squash_env` if
//! you use that method). You shouldn't need to use `ProgramMemory` for much, other
//! than creating new `Stack`s which is always safe (doesn't mutate `ProgramMemory`). After interpreting
//! std, you'll need to call `set_std` and for this you must have a unique reference to `ProgramMemory`,
//! but if you don't we'll just panic, not cause a safety issue. `get_from` and `find_all_in_env`
//! take an owner parameter and follow the thread-safety invariants below.
//!
//! The rest of this section describes the implementation and thread-safety invariants, you should
//! only need to understand it if you're modifying this file (or want to call a few, rarely used
//! functions).
//!
//! The memory system is a lock-free, mostly wait-free structure. Safety is guaranteed by a few
//! invariants which are maintained (mostly) internally. There are two areas of mutability which
//! we need to think about: modifying, updating, or deleting items in memory, and adding or deleting
//! environments. Other areas of mutation are maintaining the call stacks which is always trivially
//! thread-local and collecting stats which is trivially atomic.
//!
//! A key invariant for modifying memory items is that each env is either uniquely owned by a single
//! `Stack` (when it is active, i.e., part of a call stack) or is read-only (once interpretation of
//! the scope backed by the env is complete and the env is no longer on any call stack). Being on a
//! call stack means the env is owned by that `Stack`. Since the envs are all kept by the `ProgramMemory`
//! singleton (so that env refs work), we can't rely on Rust ownership to enforce this. Instead, each
//! `Stack` has an id (ordering of which is irrelevant) and each env has an owner id - if this is 0,
//! the env is read-only, if not it is owned by the stack with that id. An env can be read or written
//! by it's owning stack, or if read-only can be read by anyone but never written.
//!
//! We check this dynamically, but the checks are assertions and should never fail. The safety invariant
//! is ensured by construction - memory in a `Stack` should not be referenced from another `Stack`,
//! memory should only be referenced once interpretation related to it is finished. This is actually
//! a stronger requirement than is strictly necessary but it is easy to reason about. To be precise,
//! it is safe to reference a name in an env once it has been popped from a stack and as long as it
//! doesn't again become active.
//!
//! Accessing an env is safe because they are stored on the heap and cannot be moved, even if the
//! env storage is reorganised (which should only be due to reallocation, we can't move envs within
//! storage since their indices must be kept consistent).
//!
//! Adding or removing an env from storage is protected by a 'lock' field in `ProgramMemory`. Modification
//! of the env storage must only happen when holding this lock (use `with_envs`). `with_envs` uses a
//! simple spin lock to wait (the only non-wait-free action) so don't hold the lock for long (currently
//! the only time this might happen is if the env storage re-sizes and thus reallocates). Reading an
//! env does not require any lock - an env can never be moved, access to the env must be either
//! read-only or unique, and (importantly) modifying the environments cannot remove an env unless it
//! is guaranteed there are no references to the env.
//!
//! Edge case: what if an env transitions ownership state at the same time as the env storage is
//! modified? This shouldn't be a technical issue, because the owner field of an env is only used to
//! check safety, it is not ever used for any decision. In any case, modifying the env storage is
//! must be safe if the env is in either state, so even if the transition happens at the same time
//! as the storage modification, it is ok.

use std::{
    cell::UnsafeCell,
    fmt,
    pin::Pin,
    sync::{
        Arc,
        atomic::{AtomicBool, AtomicUsize, Ordering},
    },
};

use anyhow::Result;
use env::Environment;
use indexmap::IndexMap;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use crate::{
    errors::{KclError, KclErrorDetails},
    execution::KclValue,
    source_range::SourceRange,
};

/// The distinguished name of the return value of a function.
pub(crate) const RETURN_NAME: &str = "__return";
/// Low-budget namespacing for types and modules.
pub(crate) const TYPE_PREFIX: &str = "__ty_";
pub(crate) const MODULE_PREFIX: &str = "__mod_";

/// KCL memory. There should be only one ProgramMemory for the interpretation of a program (
/// including other modules). Multiple interpretation runs should have fresh instances.
///
/// See module docs.
#[derive(Debug)]
pub(crate) struct ProgramMemory {
    // Environments are boxed so they will never be moved if the `Vec` reallocates. We use `Pin`
    // to help guarantee that.
    environments: UnsafeCell<Vec<Pin<Box<Environment>>>>,
    /// Memory for the std prelude.
    std: Option<EnvironmentRef>,
    /// Statistics about the memory, should not be used for anything other than meta-info.
    pub(crate) stats: MemoryStats,
    next_stack_id: AtomicUsize,
    epoch: AtomicUsize,
    write_lock: AtomicBool,
}

unsafe impl Sync for ProgramMemory {}

#[derive(Debug, Clone)]
pub(crate) struct Stack {
    pub(crate) memory: Arc<ProgramMemory>,
    id: usize,
    /// Invariant: current_env.1.is_none()
    current_env: EnvironmentRef,
    /// Invariant: forall er in call_stack: er.1.is_none()
    call_stack: Vec<EnvironmentRef>,
}

// Intended for debugging. Do not rely on this output in any way!
impl fmt::Display for ProgramMemory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let envs: Vec<String> = self
            .envs()
            .iter()
            .enumerate()
            .map(|(i, env)| format!("{i}: {env}"))
            .collect();
        write!(
            f,
            "ProgramMemory (next stack: {})\nenvs:\n{}",
            self.next_stack_id.load(Ordering::Relaxed),
            envs.join("\n")
        )
    }
}

// Intended for debugging. Do not rely on this output in any way!
impl fmt::Display for Stack {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let stack: Vec<String> = self
            .call_stack
            .iter()
            .chain(Some(&self.current_env))
            .map(|e| format!("EnvRef({}, {})", e.0, e.1))
            .collect();
        write!(f, "Stack {}\nstack frames:\n{}", self.id, stack.join("\n"))
    }
}

impl ProgramMemory {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Arc<Self> {
        Arc::new(Self {
            // Massively over-allocate here to try and avoid reallocating later.
            environments: UnsafeCell::new(Vec::with_capacity(512)),
            std: None,
            stats: MemoryStats::default(),
            next_stack_id: AtomicUsize::new(1),
            epoch: AtomicUsize::new(1),
            write_lock: AtomicBool::new(false),
        })
    }

    /// Clone this ProgramMemory.
    ///
    /// This is deliberately not a `Clone` impl or called just `clone` since it requires the write
    /// lock on the memory and so as to be totally unambiguous with cloning an `Arc` of the memory
    /// (which you should usually prefer).
    ///
    /// This is a long-running operation and holds the write lock, which is bad. Callers must ensure
    /// that no other task will need to use `self` while this runs.
    fn deep_clone(&self) -> Self {
        self.with_envs(|envs| Self {
            environments: UnsafeCell::new(envs.clone()),
            std: self.std,
            stats: MemoryStats::default(),
            next_stack_id: AtomicUsize::new(self.next_stack_id.load(Ordering::Relaxed)),
            epoch: AtomicUsize::new(self.epoch.load(Ordering::Relaxed)),
            write_lock: AtomicBool::new(false),
        })
    }

    /// Create a new stack object referencing this `ProgramMemory`.
    pub fn new_stack(self: Arc<Self>) -> Stack {
        let id = self.next_stack_id.fetch_add(1, Ordering::Relaxed);
        assert!(id > 0);
        Stack {
            id,
            memory: self,
            current_env: EnvironmentRef::dummy(),
            call_stack: Vec::new(),
        }
    }

    /// Set the env var used for the standard library prelude.
    ///
    /// Precondition: `self` must be uniquely owned.
    pub fn set_std(self: &mut Arc<Self>, std: EnvironmentRef) {
        Arc::get_mut(self).unwrap().std = Some(std);
    }

    /// Whether this memory still needs to be initialised with its standard library prelude.
    pub fn requires_std(&self) -> bool {
        self.std.is_none()
    }

    /// Get a value from a specific environment of the memory at a specific point in time.
    pub fn get_from(
        &self,
        var: &str,
        mut env_ref: EnvironmentRef,
        source_range: SourceRange,
        owner: usize,
    ) -> Result<&KclValue, KclError> {
        loop {
            let env = self.get_env(env_ref.index());
            env_ref = match env.get(var, env_ref.1, owner) {
                Ok(item) => return Ok(item),
                Err(Some(parent)) => parent,
                Err(None) => break,
            };
        }

        let name = var.trim_start_matches(TYPE_PREFIX).trim_start_matches(MODULE_PREFIX);

        Err(KclError::new_undefined_value(
            KclErrorDetails::new(format!("`{name}` is not defined"), vec![source_range]),
            Some(name.to_owned()),
        ))
    }

    /// Iterate over all key/value pairs in the specified environment which satisfy the provided
    /// predicate.
    fn find_all_in_env<'a>(
        &'a self,
        env: EnvironmentRef,
        pred: impl Fn(&KclValue) -> bool + 'a,
        owner: usize,
    ) -> impl Iterator<Item = (&'a String, &'a KclValue)> {
        assert!(!env.skip_env());
        self.get_env(env.index()).find_all_by(pred, owner)
    }

    fn envs(&self) -> &[Pin<Box<Environment>>] {
        unsafe { self.environments.get().as_ref().unwrap() }
    }

    #[track_caller]
    fn get_env(&self, index: usize) -> &Environment {
        unsafe { &self.environments.get().as_ref().unwrap()[index] }
    }

    /// Mutable access to the environments. Prefer using higher-level methods if possible.
    ///
    /// Uses a spin lock to wait for write access, so `f` must not be even slightly long-running.
    fn with_envs<T>(&self, f: impl FnOnce(&mut Vec<Pin<Box<Environment>>>) -> T) -> T {
        // Spin lock
        while self.write_lock.swap(true, Ordering::AcqRel) {
            // Atomics wrap on overflow, so no chance of panicking here.
            self.stats.lock_waits.fetch_add(1, Ordering::Relaxed);
            std::hint::spin_loop();
        }

        let envs = unsafe { self.environments.get().as_mut().unwrap() };
        let result = f(envs);

        let locked = self.write_lock.fetch_not(Ordering::AcqRel);
        assert!(locked);

        result
    }

    /// Create a new environment, add it to the list of envs, and return it's ref.
    fn new_env(&self, parent: Option<EnvironmentRef>, is_root_env: bool, owner: usize) -> EnvironmentRef {
        assert!(owner > 0);
        self.stats.env_count.fetch_add(1, Ordering::Relaxed);

        let new_env = Environment::new(parent, is_root_env, owner);
        self.with_envs(|envs| {
            let result = EnvironmentRef(envs.len(), usize::MAX);
            // Note this might reallocate, which would hold the `with_envs` spin lock for way too long
            // so somehow we should make sure we don't do that (though honestly the chance of that
            // happening while another thread is waiting for the lock is pretty small).
            envs.push(Box::pin(new_env));
            result
        })
    }

    /// Handle tidying up an env when it has been popped from the call stack.
    ///
    /// If the env must be preserved, it is. If not, then it will be removed or compacted.
    fn pop_env(&self, old: EnvironmentRef, owner: usize) {
        // If the env can't be referenced delete all it's bindings.
        self.get_env(old.index()).compact(owner);

        if self.get_env(old.index()).is_empty() {
            self.with_envs(|envs| {
                if old.index() == envs.len() - 1 {
                    // We can pop the env from the vec.
                    self.stats.env_gcs.fetch_add(1, Ordering::Relaxed);
                    envs.pop();
                } else {
                    // The env is empty, but we can't pop it. Just leave it around (it can't be
                    // referenced).
                    self.stats.skipped_env_gcs.fetch_add(1, Ordering::Relaxed);
                    envs[old.index()].read_only();
                }
            });
        } else {
            // Env is non-empty, so preserve it.
            self.stats.preserved_envs.fetch_add(1, Ordering::Relaxed);
            self.get_env(old.index()).read_only();
        }
    }

    fn take_env(&self, old: EnvironmentRef) -> Pin<Box<Environment>> {
        self.with_envs(|envs| {
            if old.index() == envs.len() - 1 {
                // We can pop the env from the vec.
                self.stats.env_gcs.fetch_add(1, Ordering::Relaxed);
                envs.pop().unwrap()
            } else {
                // We can't pop because the env is not at the end of the vec and we must maintain
                // the indices. Replace the env with an empty one. It can no longer be referenced
                // so we don't care about it.
                self.stats.skipped_env_gcs.fetch_add(1, Ordering::Relaxed);
                std::mem::replace(&mut envs[old.index()], Box::pin(Environment::new(None, false, 0)))
            }
        })
    }

    /// Get a value from memory without checking for ownership of the env.
    ///
    /// This is not safe to use in general and should only be used if you have unique access to
    /// the `self` which is generally only true during testing.
    #[cfg(test)]
    pub fn get_from_unchecked(&self, var: &str, mut env_ref: EnvironmentRef) -> Result<&KclValue, KclError> {
        loop {
            let env = self.get_env(env_ref.index());
            env_ref = match env.get_unchecked(var, env_ref.1) {
                Ok(item) => return Ok(item),
                Err(Some(parent)) => parent,
                Err(None) => break,
            };
        }

        Err(KclError::new_undefined_value(
            KclErrorDetails::new(format!("`{var}` is not defined"), vec![]),
            Some(var.to_owned()),
        ))
    }
}

impl Stack {
    /// Clone this `Stack` and the underlying `ProgramMemory`.
    ///
    /// This is a long-running operation and holds the write lock, which is bad. Callers must ensure
    /// that no other task will need to use the `ProgramMemory` while this runs.
    pub fn deep_clone(&self) -> Stack {
        let mem = self.memory.deep_clone();
        let mut stack = self.clone();
        stack.memory = Arc::new(mem);
        stack
    }

    #[cfg(test)]
    /// If you're using ProgramMemory directly for testing it must be initialized first.
    pub fn new_for_tests() -> Stack {
        let mut stack = ProgramMemory::new().new_stack();
        stack.push_new_root_env(false);
        stack.memory.set_std(stack.current_env);
        stack
    }

    /// Get the current (globally most recent) epoch.
    pub fn current_epoch(&self) -> usize {
        self.memory.epoch.load(Ordering::Relaxed)
    }

    /// Push a new (standard KCL) stack frame on to the call stack.
    ///
    /// `parent` is the environment where the function being called is declared (not the caller's
    /// environment, which is probably `self.current_env`).
    pub fn push_new_env_for_call(&mut self, parent: EnvironmentRef) {
        let env_ref = self.memory.new_env(Some(parent), false, self.id);
        self.call_stack.push(self.current_env);
        self.current_env = env_ref;
    }

    /// Push a stack frame for an inline scope.
    ///
    /// This should be used for blocks but is currently only used for mock execution.
    pub fn push_new_env_for_scope(&mut self) {
        // We want to use the current env as the parent.
        // We need to snapshot in case there is a function decl in the new scope.
        let snapshot = self.snapshot();
        self.push_new_env_for_call(snapshot);
    }

    /// Push a new stack frame on to the call stack with no connection to a parent environment.
    ///
    /// Suitable for executing a separate module.
    /// Precondition: include_prelude -> !self.memory.requires_std()
    pub fn push_new_root_env(&mut self, include_prelude: bool) {
        let parent = include_prelude.then(|| self.memory.std.unwrap());
        let env_ref = self.memory.new_env(parent, true, self.id);
        self.call_stack.push(self.current_env);
        self.current_env = env_ref;
    }

    /// Push a previously used environment on to the call stack.
    ///
    /// SAFETY: the env must not be being used by another `Stack` since we'll move the env from
    /// read-only to owned.
    pub fn restore_env(&mut self, env: EnvironmentRef) {
        self.call_stack.push(self.current_env);
        self.memory.get_env(env.index()).restore_owner(self.id);
        self.current_env = env;
    }

    /// Pop a frame from the call stack and return a reference to the popped environment. The popped
    /// environment is preserved if it may be referenced (so the returned reference will remain valid).
    ///
    /// The popped environment may be retained completely (if it may be referenced by a function decl
    /// or import) or retained but its contents deleted or completely discarded.
    pub fn pop_env(&mut self) -> EnvironmentRef {
        let old = self.current_env;
        self.current_env = self.call_stack.pop().unwrap();

        if !old.skip_env() {
            self.memory.pop_env(old, self.id);
        }

        old
    }

    /// Pop a frame from the call stack and return a reference to the popped environment. The popped
    /// environment is always preserved.
    pub fn pop_and_preserve_env(&mut self) -> EnvironmentRef {
        let old = self.current_env;
        self.current_env = self.call_stack.pop().unwrap();
        if !old.skip_env() {
            self.memory.get_env(old.index()).read_only();
        }
        old
    }

    /// Merges the specified environment with the current environment, rewriting any environment refs
    /// taking snapshots into account. Deletes (if possible) or clears the squashed environment.
    ///
    /// Precondition: the caller must have unique access to the env pointed to by `old` and there must be
    /// no extant references to it. If violated there may be dangling references to the old env once
    /// it is removed from storage.
    pub fn squash_env(&mut self, old: EnvironmentRef) {
        assert!(!old.skip_env());
        if self.current_env.skip_env() {
            return;
        }

        let mut old_env = self.memory.take_env(old);
        if old_env.is_empty() {
            return;
        }

        // Make a new scope so we override variables properly.
        self.push_new_env_for_scope();
        // Move the variables in the popped env into the current env.
        let env = self.memory.get_env(self.current_env.index());
        for (k, (e, v)) in old_env.as_mut().take_bindings() {
            env.insert(k, e, v.map_env_ref(old.0, self.current_env.0), self.id);
        }
    }

    /// Snapshot the current state of the memory.
    pub fn snapshot(&mut self) -> EnvironmentRef {
        self.memory.stats.epoch_count.fetch_add(1, Ordering::Relaxed);

        let env = self.memory.get_env(self.current_env.index());
        env.mark_as_refed();

        let prev_epoch = self.memory.epoch.fetch_add(1, Ordering::Relaxed);
        EnvironmentRef(self.current_env.0, prev_epoch)
    }

    /// Add a value to the program memory (in the current scope). The value must not already exist.
    pub fn add(&mut self, key: String, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        let env = self.memory.get_env(self.current_env.index());
        if env.contains_key(&key) {
            return Err(KclError::new_value_already_defined(KclErrorDetails::new(
                format!("Cannot redefine `{key}`"),
                vec![source_range],
            )));
        }

        self.memory.stats.mutation_count.fetch_add(1, Ordering::Relaxed);

        env.insert(key, self.memory.epoch.load(Ordering::Relaxed), value, self.id);

        Ok(())
    }

    /// Update a variable in memory. `key` must exist in memory. If it doesn't, this function will panic
    /// in debug builds and do nothing in release builds.
    pub fn update(&mut self, key: &str, f: impl Fn(&mut KclValue, usize)) {
        self.memory.stats.mutation_count.fetch_add(1, Ordering::Relaxed);
        self.memory.get_env(self.current_env.index()).update(
            key,
            f,
            self.memory.epoch.load(Ordering::Relaxed),
            self.id,
        );
    }

    /// Get a value from the program memory.
    /// Return Err if not found.
    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<&KclValue, KclError> {
        self.memory.get_from(var, self.current_env, source_range, self.id)
    }

    /// Whether the current frame of the stack contains a variable with the given name.
    pub fn cur_frame_contains(&self, var: &str) -> bool {
        let env = self.memory.get_env(self.current_env.index());
        env.contains_key(var)
    }

    /// Get a key from the first stack frame on the call stack.
    pub fn get_from_call_stack(&self, key: &str, source_range: SourceRange) -> Result<(usize, &KclValue), KclError> {
        if !self.current_env.skip_env() {
            return Ok((self.current_env.1, self.get(key, source_range)?));
        }

        for env in self.call_stack.iter().rev() {
            if !env.skip_env() {
                return Ok((env.1, self.memory.get_from(key, *env, source_range, self.id)?));
            }
        }

        unreachable!("No frames on the stack?");
    }

    /// Iterate over all keys in the current environment which satisfy the provided predicate.
    pub fn find_keys_in_current_env<'a>(
        &'a self,
        pred: impl Fn(&KclValue) -> bool + 'a,
    ) -> impl Iterator<Item = &'a String> {
        self.memory
            .find_all_in_env(self.current_env, pred, self.id)
            .map(|(k, _)| k)
    }

    /// Iterate over all key/value pairs in the specified environment which satisfy the provided
    /// predicate. `env` must either be read-only or owned by `self`.
    pub fn find_all_in_env(&self, env: EnvironmentRef) -> impl Iterator<Item = (&String, &KclValue)> {
        self.memory.find_all_in_env(env, |_| true, self.id)
    }

    /// Walk all values accessible from any environment in the call stack.
    ///
    /// This may include duplicate values or different versions of a value known by the same key,
    /// since an environment may be accessible via multiple paths.
    pub fn walk_call_stack(&self) -> impl Iterator<Item = &KclValue> {
        let mut cur_env = self.current_env;
        let mut stack_index = self.call_stack.len();
        while cur_env.skip_env() {
            stack_index -= 1;
            cur_env = self.call_stack[stack_index];
        }

        let mut result = CallStackIterator {
            cur_env,
            cur_values: None,
            stack_index,
            stack: self,
        };
        result.init_iter();
        result
    }
}

// See walk_call_stack.
struct CallStackIterator<'a> {
    stack: &'a Stack,
    cur_env: EnvironmentRef,
    cur_values: Option<Box<dyn Iterator<Item = &'a KclValue> + 'a>>,
    stack_index: usize,
}

impl CallStackIterator<'_> {
    fn init_iter(&mut self) {
        self.cur_values = Some(self.stack.memory.get_env(self.cur_env.index()).values(self.cur_env.1));
    }
}

impl<'a> Iterator for CallStackIterator<'a> {
    type Item = &'a KclValue;

    fn next(&mut self) -> Option<Self::Item> {
        self.cur_values.as_ref()?;

        // Loop over each frame in the call stack.
        'outer: loop {
            // Loop over each environment in the tree of scopes of which the current stack frame is a leaf.
            loop {
                // `unwrap` is OK since we check for None at the start of the function, and if we update
                // cur_values then it must be to Some(..).
                let next = self.cur_values.as_mut().unwrap().next();
                if next.is_some() {
                    return next;
                }

                if let Some(env_ref) = self.stack.memory.get_env(self.cur_env.index()).parent() {
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
                    let env_ref = self.stack.call_stack[self.stack_index];

                    if !env_ref.skip_env() {
                        self.cur_env = env_ref;
                        self.init_iter();
                        break;
                    } else if self.stack_index == 0 {
                        break 'outer;
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
impl PartialEq for Stack {
    fn eq(&self, other: &Self) -> bool {
        let vars: Vec<_> = self.find_keys_in_current_env(|_| true).collect();
        let vars_other: Vec<_> = other.find_keys_in_current_env(|_| true).collect();
        if vars != vars_other {
            return false;
        }

        vars.iter()
            .all(|k| self.get(k, SourceRange::default()).unwrap() == other.get(k, SourceRange::default()).unwrap())
    }
}

/// An index pointing to an environment at a point in time.
///
/// The first field indexes an environment, the second field is an epoch. An epoch of 0 is indicates
/// a dummy, error, or placeholder env ref, an epoch of `usize::MAX` represents the current most
/// recent epoch.
#[derive(Debug, Clone, Copy, Deserialize, Serialize, PartialEq, Hash, Eq, ts_rs::TS, JsonSchema)]
pub struct EnvironmentRef(usize, usize);

impl EnvironmentRef {
    pub fn dummy() -> Self {
        Self(usize::MAX, 0)
    }

    fn is_regular(&self) -> bool {
        self.0 < usize::MAX && self.1 > 0
    }

    fn index(&self) -> usize {
        self.0
    }

    fn skip_env(&self) -> bool {
        self.0 == usize::MAX
    }

    pub fn replace_env(&mut self, old: usize, new: usize) {
        if self.0 == old {
            self.0 = new;
        }
    }
}

// TODO keep per-stack stats to avoid so many atomic updates
#[derive(Debug, Default)]
pub(crate) struct MemoryStats {
    // Total number of environments created.
    env_count: AtomicUsize,
    // Total number of epochs.
    epoch_count: AtomicUsize,
    // Total number of values inserted or updated.
    mutation_count: AtomicUsize,
    // The number of envs we delete when popped from the call stack.
    env_gcs: AtomicUsize,
    // The number of empty envs we can't delete when popped from the call stack.
    skipped_env_gcs: AtomicUsize,
    // The number of envs we can't delete when popped from the call stack because they may be referenced.
    preserved_envs: AtomicUsize,
    // The number of iterations waiting for a spin lock.
    lock_waits: AtomicUsize,
}

// Use a sub-module to protect access to `Environment::bindings` and prevent unexpected mutatation
// of stored values.
mod env {
    use std::marker::PhantomPinned;

    use super::*;

    #[derive(Debug)]
    pub(super) struct Environment {
        bindings: UnsafeCell<IndexMap<String, (usize, KclValue)>>,
        // An outer scope, if one exists.
        parent: Option<EnvironmentRef>,
        might_be_refed: AtomicBool,
        // The id of the `Stack` if this `Environment` is on a call stack. If this is >0 then it may
        // only be read or written by that `Stack`; if 0 then the env is read-only.
        owner: AtomicUsize,
        // Ensure Environment: !Unpin
        _unpin: PhantomPinned,
    }

    impl Clone for Environment {
        fn clone(&self) -> Self {
            assert!(self.owner.load(Ordering::Acquire) == 0);
            Self {
                bindings: UnsafeCell::new(self.get_bindings().clone()),
                parent: self.parent,
                might_be_refed: AtomicBool::new(self.might_be_refed.load(Ordering::Acquire)),
                owner: AtomicUsize::new(0),
                _unpin: PhantomPinned,
            }
        }
    }

    impl fmt::Display for Environment {
        fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
            let parent = self
                .parent
                .map(|e| format!("EnvRef({}, {})", e.0, e.1))
                .unwrap_or("_".to_owned());
            let data: Vec<String> = self
                .get_bindings()
                .iter()
                .map(|(k, v)| format!("{k}: {}@{}", v.1.human_friendly_type(), v.0))
                .collect();
            write!(
                f,
                "Env {{\n  parent: {parent},\n  owner: {},\n  ref'ed?: {},\n  bindings:\n    {}\n}}",
                self.owner.load(Ordering::Relaxed),
                self.might_be_refed.load(Ordering::Relaxed),
                data.join("\n    "),
            )
        }
    }

    impl Environment {
        /// Create a new environment, parent points to it's surrounding lexical scope or the std
        /// env if it's a root scope.
        pub(super) fn new(parent: Option<EnvironmentRef>, might_be_refed: bool, owner: usize) -> Self {
            assert!(parent.map(|p| p.is_regular()).unwrap_or(true));
            Self {
                bindings: UnsafeCell::new(IndexMap::new()),
                parent,
                might_be_refed: AtomicBool::new(might_be_refed),
                owner: AtomicUsize::new(owner),
                _unpin: PhantomPinned,
            }
        }

        /// Mark this env as read-only (see module docs).
        pub(super) fn read_only(&self) {
            self.owner.store(0, Ordering::Release);
        }

        /// Mark this env as owned (see module docs).
        pub(super) fn restore_owner(&self, owner: usize) {
            self.owner.store(owner, Ordering::Release);
        }

        /// Mark this environment as possibly having external references.
        pub(super) fn mark_as_refed(&self) {
            self.might_be_refed.store(true, Ordering::Release);
        }

        // SAFETY: either the owner of the env is on the Rust stack or the env is read-only.
        fn get_bindings(&self) -> &IndexMap<String, (usize, KclValue)> {
            unsafe { self.bindings.get().as_ref().unwrap() }
        }

        // SAFETY do not call this function while a previous mutable reference is live
        #[allow(clippy::mut_from_ref)]
        fn get_mut_bindings(&self, owner: usize) -> &mut IndexMap<String, (usize, KclValue)> {
            assert!(owner > 0 && self.owner.load(Ordering::Acquire) == owner);
            unsafe { self.bindings.get().as_mut().unwrap() }
        }

        // True if the env is empty and has no external references.
        pub(super) fn is_empty(&self) -> bool {
            self.get_bindings().is_empty() && !self.might_be_refed.load(Ordering::Acquire)
        }

        /// Possibly compress this environment by deleting the memory.
        ///
        /// This method will return without changing anything if the environment may be referenced
        /// (this is a pretty conservative approximation, but if you keep an EnvironmentRef around
        /// in a new way it might be incorrect).
        ///
        /// See module docs for more details.
        pub(super) fn compact(&self, owner: usize) {
            // Don't compress if there might be a closure or import referencing us.
            if self.might_be_refed.load(Ordering::Acquire) {
                return;
            }

            *self.get_mut_bindings(owner) = IndexMap::new();
        }

        pub(super) fn get(&self, key: &str, epoch: usize, owner: usize) -> Result<&KclValue, Option<EnvironmentRef>> {
            let env_owner = self.owner.load(Ordering::Acquire);
            assert!(env_owner == 0 || env_owner == owner);

            self.get_unchecked(key, epoch)
        }

        /// Get a value from memory without checking the env's ownership invariant. Prefer to use `get`.
        pub(super) fn get_unchecked(&self, key: &str, epoch: usize) -> Result<&KclValue, Option<EnvironmentRef>> {
            self.get_bindings()
                .get(key)
                .and_then(|(e, v)| if *e <= epoch { Some(v) } else { None })
                .ok_or(self.parent)
        }

        pub(super) fn update(&self, key: &str, f: impl Fn(&mut KclValue, usize), epoch: usize, owner: usize) {
            let Some((_, value)) = self.get_mut_bindings(owner).get_mut(key) else {
                debug_assert!(false, "Missing memory entry for {key}");
                return;
            };

            f(value, epoch);
        }

        pub(super) fn parent(&self) -> Option<EnvironmentRef> {
            self.parent
        }

        /// Iterate over all values in the environment at the specified epoch.
        pub(super) fn values<'a>(&'a self, epoch: usize) -> Box<dyn Iterator<Item = &'a KclValue> + 'a> {
            Box::new(
                self.get_bindings()
                    .values()
                    .filter_map(move |(e, v)| (*e <= epoch).then_some(v)),
            )
        }

        /// Pure insert, panics if `key` is already in this environment.
        ///
        /// Precondition: !self.contains_key(key)
        pub(super) fn insert(&self, key: String, epoch: usize, value: KclValue, owner: usize) {
            debug_assert!(!self.get_bindings().contains_key(&key));
            self.get_mut_bindings(owner).insert(key, (epoch, value));
        }

        /// Is the key currently contained in this environment.
        pub(super) fn contains_key(&self, key: &str) -> bool {
            self.get_bindings().contains_key(key)
        }

        /// Iterate over all key/value pairs currently in this environment where the value satisfies
        /// the providied predicate (`f`).
        pub(super) fn find_all_by<'a>(
            &'a self,
            f: impl Fn(&KclValue) -> bool + 'a,
            owner: usize,
        ) -> impl Iterator<Item = (&'a String, &'a KclValue)> {
            let env_owner = self.owner.load(Ordering::Acquire);
            assert!(env_owner == 0 || env_owner == owner);

            self.get_bindings()
                .iter()
                .filter_map(move |(k, (_, v))| f(v).then_some((k, v)))
        }

        /// Take all bindings from the environment.
        pub(super) fn take_bindings(self: Pin<&mut Self>) -> impl Iterator<Item = (String, (usize, KclValue))> + use<> {
            // SAFETY: caller must have unique access since self is mut. We're not moving or invalidating `self`.
            let bindings = std::mem::take(unsafe { self.bindings.get().as_mut().unwrap() });
            bindings.into_iter()
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use crate::execution::{kcl_value::FunctionSource, types::NumericType};

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
    fn assert_get(mem: &Stack, key: &str, n: i64) {
        match mem.get(key, sr()).unwrap() {
            KclValue::Number { value, .. } => assert_eq!(*value as i64, n),
            _ => unreachable!(),
        }
    }

    #[track_caller]
    fn assert_get_from(mem: &Stack, key: &str, n: i64, snapshot: EnvironmentRef) {
        match mem.memory.get_from_unchecked(key, snapshot).unwrap() {
            KclValue::Number { value, .. } => assert_eq!(*value as i64, n),
            _ => unreachable!(),
        }
    }

    #[test]
    fn mem_smoke() {
        // Follows test_pattern_transform_function_cannot_access_future_definitions

        let mem = &mut Stack::new_for_tests();
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
        let mem = &mut Stack::new_for_tests();
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
        mem.memory.get_from_unchecked("b", sn).unwrap_err();
    }

    #[test]
    fn multiple_snapshot() {
        let mem = &mut Stack::new_for_tests();
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
        mem.memory.get_from_unchecked("b", sn1).unwrap_err();
        mem.memory.get_from_unchecked("c", sn1).unwrap_err();
        assert_get_from(mem, "a", 1, sn2);
        assert_get_from(mem, "b", 3, sn2);
        mem.memory.get_from_unchecked("c", sn2).unwrap_err();
    }

    #[test]
    fn simple_call_env() {
        let mem = &mut Stack::new_for_tests();
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
        let mem = &mut Stack::new_for_tests();
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
        let mem = &mut Stack::new_for_tests();
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();

        mem.push_new_root_env(false);
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
    fn deep_call_env() {
        let mem = &mut Stack::new_for_tests();
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
        let mem = &mut Stack::new_for_tests();
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
        mem.memory.get_from_unchecked("b", sn).unwrap_err();
    }

    #[test]
    fn snap_env2() {
        let mem = &mut Stack::new_for_tests();
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
        mem.memory.get_from_unchecked("b", sn1).unwrap_err();
        assert_get_from(mem, "b", 3, sn2);
        mem.memory.get_from_unchecked("c", sn2).unwrap_err();
        assert_get_from(mem, "b", 4, sn3);
        mem.memory.get_from_unchecked("c", sn3).unwrap_err();
    }

    #[test]
    fn squash_env() {
        let mem = &mut Stack::new_for_tests();
        mem.add("a".to_owned(), val(1), sr()).unwrap();
        mem.add("b".to_owned(), val(3), sr()).unwrap();
        let sn1 = mem.snapshot();
        mem.push_new_env_for_call(sn1);
        mem.add("b".to_owned(), val(2), sr()).unwrap();

        let sn2 = mem.snapshot();
        mem.add(
            "f".to_owned(),
            KclValue::Function {
                value: FunctionSource::User {
                    ast: crate::parsing::ast::types::FunctionExpression::dummy(),
                    settings: crate::MetaSettings::default(),
                    memory: sn2,
                },
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
            KclValue::Function {
                value: FunctionSource::User { memory, .. },
                ..
            } if memory.0 == mem.current_env.0 => {}
            v => panic!("{v:#?}, expected {sn1:?}"),
        }
        assert_eq!(mem.memory.envs().len(), 2);
    }

    #[test]
    fn two_stacks() {
        let stack1 = &mut Stack::new_for_tests();
        let stack2 = &mut stack1.memory.clone().new_stack();
        stack2.push_new_root_env(false);

        stack1.add("a".to_owned(), val(1), sr()).unwrap();
        stack1.push_new_env_for_call(stack1.current_env);

        stack2.add("a".to_owned(), val(2), sr()).unwrap();
        stack2.push_new_env_for_call(stack2.current_env);

        stack2.add("a".to_owned(), val(4), sr()).unwrap();
        stack2.push_new_env_for_call(stack2.current_env);

        stack1.add("a".to_owned(), val(3), sr()).unwrap();
        stack1.push_new_env_for_call(stack1.current_env);

        stack1.add("a".to_owned(), val(5), sr()).unwrap();
        stack1.push_new_env_for_call(stack1.current_env);

        stack2.add("a".to_owned(), val(6), sr()).unwrap();
        stack2.push_new_env_for_call(stack2.current_env);

        stack1.add("a".to_owned(), val(7), sr()).unwrap();
        stack2.add("a".to_owned(), val(8), sr()).unwrap();

        assert_get(stack1, "a", 7);
        assert_get(stack2, "a", 8);

        stack1.pop_env();
        assert_get(stack1, "a", 5);
        assert_get(stack2, "a", 8);
        stack2.pop_env();
        assert_get(stack1, "a", 5);
        assert_get(stack2, "a", 6);

        stack2.pop_env();
        assert_get(stack2, "a", 4);
        stack2.pop_env();
        assert_get(stack2, "a", 2);
        stack1.pop_env();
        assert_get(stack1, "a", 3);
        stack1.pop_env();
        assert_get(stack1, "a", 1);
    }
}
