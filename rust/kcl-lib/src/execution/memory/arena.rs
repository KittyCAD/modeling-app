//! Safe arena memory backend.
//!
//! This backend preserves the legacy environment/epoch semantics while replacing
//! unsafe shared mutable storage with lock-protected arena and environment
//! mutation. Public reads return owned values, so no lock guard escapes.
//!
//! Legacy memory docs are below.
//!
//! ## Representation of KCL memory
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
//! ```no_run
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
//! ```no_run
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
//! std, you'll need to call `set_std`. `get_from` and `find_all_in_env` take an owner parameter
//! and follow the thread-safety invariants below.
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
use std::fmt;
use std::sync::Arc;
use std::sync::OnceLock;
use std::sync::RwLock;
use std::sync::RwLockReadGuard;
use std::sync::RwLockWriteGuard;
use std::sync::atomic::AtomicUsize;
use std::sync::atomic::Ordering;

use indexmap::IndexMap;

use super::EnvironmentRef;
use super::MODULE_PREFIX;
use super::MemoryStats;
use super::TYPE_PREFIX;
use crate::SourceRange;
use crate::errors::KclError;
use crate::errors::KclErrorDetails;
use crate::execution::KclValue;

#[derive(Debug)]
pub(crate) struct ProgramMemory {
    /// Memory for the std prelude.
    std: OnceLock<EnvironmentRef>,
    /// Statistics about the memory, should not be used for anything other than meta-info.
    pub(crate) stats: MemoryStats,
    next_stack_id: AtomicUsize,
    epoch: AtomicUsize,
    environments: RwLock<EnvStore>,
}

#[derive(Debug, Clone)]
pub(crate) struct Stack {
    pub(crate) memory: Arc<ProgramMemory>,
    id: usize,
    current_env: EnvironmentRef,
    call_stack: Vec<EnvironmentRef>,
}

#[derive(Debug)]
struct Environment {
    bindings: IndexMap<String, (usize, KclValue)>,
    parent: Option<EnvironmentRef>,
    might_be_refed: bool,
    owner: usize,
}

type EnvStore = Vec<Arc<RwLock<Environment>>>;
type EnvTableReadGuard<'a> = RwLockReadGuard<'a, EnvStore>;
type EnvTableWriteGuard<'a> = RwLockWriteGuard<'a, EnvStore>;
type EnvReadGuard<'a> = RwLockReadGuard<'a, Environment>;
type EnvWriteGuard<'a> = RwLockWriteGuard<'a, Environment>;

fn once_lock_copy(value: Option<EnvironmentRef>) -> OnceLock<EnvironmentRef> {
    let lock = OnceLock::new();
    if let Some(value) = value {
        let _ = lock.set(value);
    }
    lock
}

fn arena_lock_poisoned(op: &str, target: impl fmt::Display) -> KclError {
    KclError::new_internal(KclErrorDetails::new(
        format!(
            "KCL memory arena lock was poisoned while {op} ({target}). A previous panic may have left evaluator memory inconsistent."
        ),
        vec![],
    ))
}

fn arena_env_index_out_of_range(op: &str, index: usize, len: usize) -> KclError {
    KclError::new_internal(KclErrorDetails::new(
        format!(
            "KCL memory arena invariant failed while {op}: environment index {index} is out of range; environment table has {len} entries."
        ),
        vec![],
    ))
}

fn arena_invariant_failed(op: &str, detail: impl fmt::Display) -> KclError {
    KclError::new_internal(KclErrorDetails::new(
        format!("KCL memory arena invariant failed while {op}: {detail}."),
        vec![],
    ))
}

impl fmt::Display for ProgramMemory {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let env_count = match self.environments.read() {
            Ok(envs) => envs.len().to_string(),
            Err(_) => {
                "<unavailable: ProgramMemory.environments RwLock is poisoned; look for an earlier panic while mutating or reading the arena environment table>".to_owned()
            }
        };
        write!(
            f,
            "ArenaProgramMemory (next stack: {}, envs: {})",
            self.next_stack_id.load(Ordering::Relaxed),
            env_count
        )
    }
}

impl fmt::Display for Stack {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        let stack: Vec<String> = self
            .call_stack
            .iter()
            .copied()
            .chain(Some(self.current_env))
            .map(|e| format!("EnvRef({}, {})", e.index(), e.epoch()))
            .collect();
        write!(f, "ArenaStack {}\nstack frames:\n{}", self.id, stack.join("\n"))
    }
}

impl ProgramMemory {
    #[allow(clippy::new_without_default)]
    pub fn new() -> Arc<Self> {
        Self::new_arena()
    }

    fn new_arena() -> Arc<Self> {
        Arc::new(Self {
            std: OnceLock::new(),
            stats: MemoryStats::default(),
            next_stack_id: AtomicUsize::new(1),
            epoch: AtomicUsize::new(1),
            environments: RwLock::new(Vec::new()),
        })
    }

    fn deep_clone(&self) -> Result<Self, KclError> {
        let envs = self.read_env_table("cloning memory arena")?;
        let environments = envs
            .iter()
            .enumerate()
            .map(|(index, env)| {
                Ok(Arc::new(RwLock::new(
                    self.read_env(env, index, "cloning memory arena")?
                        .clone_readonly_checked(index, "cloning memory arena")?,
                )))
            })
            .collect::<Result<Vec<_>, KclError>>()?;

        Ok(Self {
            std: once_lock_copy(self.std.get().copied()),
            stats: MemoryStats::default(),
            next_stack_id: AtomicUsize::new(self.next_stack_id.load(Ordering::Relaxed)),
            epoch: AtomicUsize::new(self.epoch.load(Ordering::Relaxed)),
            environments: RwLock::new(environments),
        })
    }

    fn read_env_table(&self, op: &str) -> Result<EnvTableReadGuard<'_>, KclError> {
        self.environments
            .read()
            .map_err(|_| arena_lock_poisoned(op, "environment table"))
    }

    fn write_env_table(&self, op: &str) -> Result<EnvTableWriteGuard<'_>, KclError> {
        self.environments
            .write()
            .map_err(|_| arena_lock_poisoned(op, "environment table"))
    }

    fn get_env_checked(&self, index: usize, op: &str) -> Result<Arc<RwLock<Environment>>, KclError> {
        let envs = self.read_env_table(op)?;
        envs.get(index)
            .cloned()
            .ok_or_else(|| arena_env_index_out_of_range(op, index, envs.len()))
    }

    fn read_env<'a>(&self, env: &'a RwLock<Environment>, index: usize, op: &str) -> Result<EnvReadGuard<'a>, KclError> {
        env.read()
            .map_err(|_| arena_lock_poisoned(op, format!("environment {index}")))
    }

    fn write_env<'a>(
        &self,
        env: &'a RwLock<Environment>,
        index: usize,
        op: &str,
    ) -> Result<EnvWriteGuard<'a>, KclError> {
        env.write()
            .map_err(|_| arena_lock_poisoned(op, format!("environment {index}")))
    }

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

    pub fn set_std(self: &mut Arc<Self>, std: EnvironmentRef) -> Result<(), KclError> {
        if !std.is_regular() {
            return Err(arena_invariant_failed(
                "initializing standard library prelude",
                format!("std env ref must be regular: {std:?}"),
            ));
        }

        self.std.set(std).map_err(|_| {
            arena_invariant_failed(
                "initializing standard library prelude",
                "standard library prelude is already initialized",
            )
        })
    }

    pub fn requires_std(&self) -> bool {
        self.std.get().is_none()
    }

    pub fn get_from(
        &self,
        var: &str,
        mut env_ref: EnvironmentRef,
        source_range: SourceRange,
        owner: usize,
    ) -> Result<KclValue, KclError> {
        loop {
            let env_index = env_ref.index();
            let env = self.get_env_checked(env_index, "looking up a variable")?;
            let env = self.read_env(&env, env_index, "looking up a variable")?;
            env.check_readable_by(owner, "looking up a variable")?;
            env_ref = match env.get(var, env_ref.epoch()) {
                Ok(item) => return Ok(item),
                Err(Some(parent)) => parent,
                Err(None) => break,
            };
        }

        Err(undefined_value(var, source_range))
    }

    pub fn get_from_owned(
        &self,
        var: &str,
        env_ref: EnvironmentRef,
        source_range: SourceRange,
        owner: usize,
    ) -> Result<KclValue, KclError> {
        self.get_from(var, env_ref, source_range, owner)
    }

    fn new_env_checked(
        &self,
        parent: Option<EnvironmentRef>,
        is_root_env: bool,
        owner: usize,
        op: &str,
    ) -> Result<EnvironmentRef, KclError> {
        if owner == 0 {
            return Err(arena_invariant_failed(op, "stack owner id must be nonzero"));
        }
        let mut envs = self.write_env_table(op)?;
        let result = EnvironmentRef::current(envs.len());
        envs.push(Arc::new(RwLock::new(Environment::new_checked(
            parent,
            is_root_env,
            owner,
            op,
        )?)));
        self.stats.env_count.fetch_add(1, Ordering::Relaxed);
        Ok(result)
    }

    fn pop_env(&self, old: EnvironmentRef, owner: usize) -> Result<(), KclError> {
        let mut envs = self.write_env_table("popping environment")?;
        let env = envs
            .get(old.index())
            .cloned()
            .ok_or_else(|| arena_env_index_out_of_range("popping environment", old.index(), envs.len()))?;
        let mut env = self.write_env(&env, old.index(), "popping environment")?;
        env.compact(owner, "popping environment")?;

        if env.is_empty() && old.index() == envs.len() - 1 {
            drop(env);
            envs.pop();
            return Ok(());
        }

        env.read_only();
        Ok(())
    }

    fn take_env(&self, old: EnvironmentRef, op: &str) -> Result<Environment, KclError> {
        if !old.is_regular() {
            return Err(arena_invariant_failed(op, format!("env ref must be regular: {old:?}")));
        }

        let mut envs = self.write_env_table(op)?;
        let env = envs
            .get(old.index())
            .cloned()
            .ok_or_else(|| arena_env_index_out_of_range(op, old.index(), envs.len()))?;
        let mut env = self.write_env(&env, old.index(), op)?;
        let old_env = std::mem::replace(&mut *env, Environment::empty());
        drop(env);

        if old.index() == envs.len() - 1 {
            envs.pop();
        }

        Ok(old_env)
    }
}

impl Stack {
    pub fn deep_clone(&self) -> Result<Stack, KclError> {
        let mem = self.memory.deep_clone()?;
        let mut stack = self.clone();
        stack.memory = Arc::new(mem);
        Ok(stack)
    }

    pub fn current_epoch(&self) -> usize {
        self.memory.epoch.load(Ordering::Relaxed)
    }

    #[cfg(test)]
    pub(super) fn current_env_ref(&self) -> EnvironmentRef {
        self.current_env
    }

    pub fn push_new_env_for_call(&mut self, parent: EnvironmentRef) -> Result<(), KclError> {
        let env_ref = self
            .memory
            .new_env_checked(Some(parent), false, self.id, "pushing a call environment")?;
        self.call_stack.push(self.current_env);
        self.current_env = env_ref;
        Ok(())
    }

    pub fn push_new_env_for_scope(&mut self) -> Result<(), KclError> {
        let snapshot = self.snapshot()?;
        self.push_new_env_for_call(snapshot)
    }

    pub fn push_new_root_env(&mut self, include_prelude: bool) -> Result<(), KclError> {
        let parent = if include_prelude {
            Some(*self.memory.std.get().ok_or_else(|| {
                arena_invariant_failed(
                    "pushing a root environment",
                    "standard library prelude must be initialized before it can be included",
                )
            })?)
        } else {
            None
        };
        let env_ref = self
            .memory
            .new_env_checked(parent, true, self.id, "pushing a root environment")?;
        self.call_stack.push(self.current_env);
        self.current_env = env_ref;
        Ok(())
    }

    pub fn restore_env(&mut self, env: EnvironmentRef) -> Result<(), KclError> {
        if !env.is_regular() {
            return Err(arena_invariant_failed(
                "restoring environment",
                format!("env ref must be regular: {env:?}"),
            ));
        }

        let env_cell = self.memory.get_env_checked(env.index(), "restoring environment")?;
        self.memory
            .write_env(&env_cell, env.index(), "restoring environment")?
            .restore_owner(self.id);

        self.call_stack.push(self.current_env);
        self.current_env = env;
        Ok(())
    }

    pub fn pop_env(&mut self) -> Result<EnvironmentRef, KclError> {
        let old = self.current_env;
        self.current_env = self.call_stack.pop().ok_or_else(|| {
            arena_invariant_failed(
                "popping environment",
                "call stack is empty; no environment can be restored",
            )
        })?;

        if !old.skip_env() {
            self.memory.pop_env(old, self.id)?;
        }

        Ok(old)
    }

    pub fn pop_and_preserve_env(&mut self) -> Result<EnvironmentRef, KclError> {
        let old = self.current_env;
        self.current_env = self.call_stack.pop().ok_or_else(|| {
            arena_invariant_failed(
                "preserving and popping environment",
                "call stack is empty; no environment can be restored",
            )
        })?;
        if !old.skip_env() {
            let env_cell = self
                .memory
                .get_env_checked(old.index(), "preserving and popping environment")?;
            self.memory
                .write_env(&env_cell, old.index(), "preserving and popping environment")?
                .read_only();
        }
        Ok(old)
    }

    pub fn squash_env(&mut self, old: EnvironmentRef) -> Result<(), KclError> {
        if old.skip_env() {
            return Err(arena_invariant_failed(
                "squashing an environment",
                "cannot squash a dummy environment reference",
            ));
        }
        if self.current_env.skip_env() {
            return Ok(());
        }

        let mut old_env = self.memory.take_env(old, "squashing an environment")?;
        if old_env.is_empty() {
            return Ok(());
        }

        self.push_new_env_for_scope()?;
        let env_index = self.current_env.index();
        let env = self.memory.get_env_checked(env_index, "squashing an environment")?;
        let mut env = self.memory.write_env(&env, env_index, "squashing an environment")?;
        for (key, (epoch, value)) in old_env.take_bindings() {
            env.insert(
                key,
                epoch,
                value.map_env_ref(old, self.current_env),
                self.id,
                "squashing an environment",
            )?;
        }
        Ok(())
    }

    pub fn snapshot(&mut self) -> Result<EnvironmentRef, KclError> {
        self.memory.stats.epoch_count.fetch_add(1, Ordering::Relaxed);

        let env_index = self.current_env.index();
        let env = self.memory.get_env_checked(env_index, "snapshotting an environment")?;
        self.memory
            .write_env(&env, env_index, "snapshotting an environment")?
            .mark_as_refed();

        let prev_epoch = self.memory.epoch.fetch_add(1, Ordering::Relaxed);
        Ok(EnvironmentRef::at_epoch(self.current_env.index(), prev_epoch))
    }

    pub fn add(&mut self, key: String, value: KclValue, source_range: SourceRange) -> Result<(), KclError> {
        let env_index = self.current_env.index();
        let env = self.memory.get_env_checked(env_index, "adding a binding")?;
        let mut env = self.memory.write_env(&env, env_index, "adding a binding")?;
        if env.contains_key(&key) {
            return Err(KclError::new_value_already_defined(KclErrorDetails::new(
                format!("Cannot redefine `{key}`"),
                vec![source_range],
            )));
        }

        self.memory.stats.mutation_count.fetch_add(1, Ordering::Relaxed);
        env.insert(
            key,
            self.memory.epoch.load(Ordering::Relaxed),
            value,
            self.id,
            "adding a binding",
        )?;
        Ok(())
    }

    pub fn add_recursive_closure(
        &mut self,
        key: String,
        value: KclValue,
        placeholder_env_ref: EnvironmentRef,
        source_range: SourceRange,
    ) -> Result<KclValue, KclError> {
        let original_env = self.current_env;
        let env_index = self.current_env.index();
        let env = self
            .memory
            .get_env_checked(env_index, "adding a recursive closure binding")?;
        {
            let mut env = self
                .memory
                .write_env(&env, env_index, "adding a recursive closure binding")?;
            if env.contains_key(&key) {
                return Err(KclError::new_value_already_defined(KclErrorDetails::new(
                    format!("Cannot redefine `{key}`"),
                    vec![source_range],
                )));
            }

            self.memory.stats.mutation_count.fetch_add(1, Ordering::Relaxed);
            env.insert(
                key.clone(),
                self.current_epoch(),
                value.clone(),
                self.id,
                "adding a recursive closure binding",
            )?;
        }

        let fixed_env_ref = self.snapshot()?;
        let fixed_closure = value.map_env_ref_and_epoch(placeholder_env_ref, fixed_env_ref);
        let original_env_index = original_env.index();
        let original_env = self
            .memory
            .get_env_checked(original_env_index, "fixing a recursive closure binding")?;
        self.memory
            .write_env(&original_env, original_env_index, "fixing a recursive closure binding")?
            .update(
                &key,
                |closure, _| {
                    *closure = fixed_closure.clone();
                },
                self.current_epoch(),
                self.id,
            )?;

        Ok(fixed_closure)
    }

    pub fn update(&mut self, key: &str, f: impl Fn(&mut KclValue, usize)) -> Result<(), KclError> {
        self.memory.stats.mutation_count.fetch_add(1, Ordering::Relaxed);
        let env_index = self.current_env.index();
        let env = self.memory.get_env_checked(env_index, "updating a binding")?;
        self.memory.write_env(&env, env_index, "updating a binding")?.update(
            key,
            f,
            self.memory.epoch.load(Ordering::Relaxed),
            self.id,
        )
    }

    pub fn get(&self, var: &str, source_range: SourceRange) -> Result<KclValue, KclError> {
        self.memory.get_from(var, self.current_env, source_range, self.id)
    }

    pub fn get_owned(&self, var: &str, source_range: SourceRange) -> Result<KclValue, KclError> {
        self.get(var, source_range)
    }

    pub fn cur_frame_contains(&self, var: &str) -> Result<bool, KclError> {
        let env_index = self.current_env.index();
        let env = self.memory.get_env_checked(env_index, "checking current frame")?;
        Ok(self
            .memory
            .read_env(&env, env_index, "checking current frame")?
            .contains_key(var))
    }

    pub fn get_from_call_stack(&self, key: &str, source_range: SourceRange) -> Result<(usize, KclValue), KclError> {
        if !self.current_env.skip_env() {
            return Ok((self.current_env.epoch(), self.get(key, source_range)?));
        }

        for env in self.call_stack.iter().rev() {
            if !env.skip_env() {
                return Ok((env.epoch(), self.memory.get_from(key, *env, source_range, self.id)?));
            }
        }

        Err(arena_invariant_failed(
            "looking up a binding from the call stack",
            "current environment is dummy and call stack contains no readable frames",
        ))
    }

    pub fn find_keys_in_current_env(&self, pred: impl Fn(&KclValue) -> bool) -> Result<Vec<String>, KclError> {
        let env_index = self.current_env.index();
        let env = self
            .memory
            .get_env_checked(env_index, "enumerating current environment")?;
        Ok(self
            .memory
            .read_env(&env, env_index, "enumerating current environment")?
            .find_all_by(pred, self.id, "enumerating current environment")?
            .into_iter()
            .map(|(key, _)| key)
            .collect())
    }

    pub fn find_all_in_current_env(&self) -> Result<Vec<(String, KclValue)>, KclError> {
        self.find_all_in_env(self.current_env)
    }

    pub fn find_all_in_env(&self, env: EnvironmentRef) -> Result<Vec<(String, KclValue)>, KclError> {
        if !env.is_regular() {
            return Err(arena_invariant_failed(
                "enumerating environment",
                format!("env ref must be regular: {env:?}"),
            ));
        }
        let env_cell = self.memory.get_env_checked(env.index(), "enumerating environment")?;
        self.memory
            .read_env(&env_cell, env.index(), "enumerating environment")?
            .find_all_by(|_| true, self.id, "enumerating environment")
    }

    pub(crate) fn find_var_name_in_all_envs(
        &self,
        pred: impl Fn(&KclValue) -> bool,
    ) -> Result<Option<String>, KclError> {
        if !self.current_env.skip_env() {
            for (name, value) in self.find_all_in_env(self.current_env)? {
                if pred(&value) {
                    return Ok(Some(name));
                }
            }
        }
        for env in self.call_stack.iter().rev() {
            if env.skip_env() {
                continue;
            }
            for (name, value) in self.find_all_in_env(*env)? {
                if pred(&value) {
                    return Ok(Some(name));
                }
            }
        }
        Ok(None)
    }

    pub fn walk_call_stack_with<T>(&self, mut f: impl FnMut(&KclValue) -> Option<T>) -> Result<Vec<T>, KclError> {
        let mut result = Vec::new();
        let mut cur_env = self.current_env;
        let mut stack_index = self.call_stack.len();
        while cur_env.skip_env() {
            if stack_index == 0 {
                return Ok(result);
            }
            stack_index -= 1;
            cur_env = self.call_stack[stack_index];
        }

        loop {
            let parent = {
                let env_cell = self.memory.get_env_checked(cur_env.index(), "walking call stack")?;
                let env = self.memory.read_env(&env_cell, cur_env.index(), "walking call stack")?;
                env.visit_values(cur_env.epoch(), &mut f, &mut result);
                env.parent()
            };

            if let Some(parent) = parent {
                cur_env = parent;
                continue;
            }

            if stack_index == 0 {
                break;
            }

            loop {
                stack_index -= 1;
                let env_ref = self.call_stack[stack_index];

                if !env_ref.skip_env() {
                    cur_env = env_ref;
                    break;
                } else if stack_index == 0 {
                    return Ok(result);
                }
            }
        }

        Ok(result)
    }
}

impl Environment {
    fn clone_readonly_checked(&self, index: usize, op: &str) -> Result<Self, KclError> {
        if self.owner != 0 {
            return Err(arena_invariant_failed(
                op,
                format!("environment {index} is still owned by stack {}", self.owner),
            ));
        }

        Ok(Self {
            bindings: self.bindings.clone(),
            parent: self.parent,
            might_be_refed: self.might_be_refed,
            owner: 0,
        })
    }

    fn new_checked(
        parent: Option<EnvironmentRef>,
        might_be_refed: bool,
        owner: usize,
        op: &str,
    ) -> Result<Self, KclError> {
        if let Some(parent) = parent
            && !parent.is_regular()
        {
            return Err(arena_invariant_failed(
                op,
                format!("parent env ref must be regular: {parent:?}"),
            ));
        }

        Ok(Self {
            bindings: IndexMap::new(),
            parent,
            might_be_refed,
            owner,
        })
    }

    fn empty() -> Self {
        Self {
            bindings: IndexMap::new(),
            parent: None,
            might_be_refed: false,
            owner: 0,
        }
    }

    fn read_only(&mut self) {
        self.owner = 0;
    }

    fn restore_owner(&mut self, owner: usize) {
        self.owner = owner;
    }

    fn mark_as_refed(&mut self) {
        self.might_be_refed = true;
    }

    fn is_empty(&self) -> bool {
        self.bindings.is_empty() && !self.might_be_refed
    }

    fn compact(&mut self, owner: usize, op: &str) -> Result<(), KclError> {
        if self.might_be_refed {
            return Ok(());
        }

        self.check_owned_by(owner, op)?;
        self.bindings.clear();
        Ok(())
    }

    fn get(&self, key: &str, epoch: usize) -> Result<KclValue, Option<EnvironmentRef>> {
        self.bindings
            .get(key)
            .and_then(|(created_at, value)| (*created_at <= epoch).then(|| value.clone()))
            .ok_or(self.parent)
    }

    fn update(
        &mut self,
        key: &str,
        f: impl Fn(&mut KclValue, usize),
        epoch: usize,
        owner: usize,
    ) -> Result<(), KclError> {
        self.check_owned_by(owner, "updating a binding")?;
        let Some((_, value)) = self.bindings.get_mut(key) else {
            debug_assert!(false, "Missing memory entry for {key}");
            return Err(arena_invariant_failed(
                "updating a binding",
                format!("memory entry `{key}` is missing from the current environment"),
            ));
        };

        f(value, epoch);
        Ok(())
    }

    fn parent(&self) -> Option<EnvironmentRef> {
        self.parent
    }

    fn visit_values<T>(&self, epoch: usize, f: &mut impl FnMut(&KclValue) -> Option<T>, result: &mut Vec<T>) {
        for value in self
            .bindings
            .values()
            .filter_map(|(created_at, value)| (*created_at <= epoch).then_some(value))
        {
            if let Some(value) = f(value) {
                result.push(value);
            }
        }
    }

    fn insert(&mut self, key: String, epoch: usize, value: KclValue, owner: usize, op: &str) -> Result<(), KclError> {
        self.check_owned_by(owner, op)?;
        debug_assert!(!self.bindings.contains_key(&key));
        self.bindings.insert(key, (epoch, value));
        Ok(())
    }

    fn contains_key(&self, key: &str) -> bool {
        self.bindings.contains_key(key)
    }

    fn find_all_by(
        &self,
        f: impl Fn(&KclValue) -> bool,
        owner: usize,
        op: &str,
    ) -> Result<Vec<(String, KclValue)>, KclError> {
        self.check_readable_by(owner, op)?;
        Ok(self
            .bindings
            .iter()
            .filter(|&(_, (_, value))| f(value))
            .map(|(key, (_, value))| (key.clone(), value.clone()))
            .collect())
    }

    fn take_bindings(&mut self) -> IndexMap<String, (usize, KclValue)> {
        std::mem::take(&mut self.bindings)
    }

    fn check_readable_by(&self, owner: usize, op: &str) -> Result<(), KclError> {
        if self.owner == 0 || self.owner == owner {
            return Ok(());
        }

        Err(arena_invariant_failed(
            op,
            format!(
                "environment is owned by stack {}, but stack {owner} attempted to read it",
                self.owner
            ),
        ))
    }

    fn check_owned_by(&self, owner: usize, op: &str) -> Result<(), KclError> {
        if owner > 0 && self.owner == owner {
            return Ok(());
        }

        Err(arena_invariant_failed(
            op,
            format!(
                "environment is owned by stack {}, but stack {owner} attempted to mutate it",
                self.owner
            ),
        ))
    }
}

fn undefined_value(var: &str, source_range: SourceRange) -> KclError {
    let name = var.trim_start_matches(TYPE_PREFIX).trim_start_matches(MODULE_PREFIX);
    KclError::new_undefined_value(
        KclErrorDetails::new(format!("`{name}` is not defined"), vec![source_range]),
        Some(name.to_owned()),
    )
}
