use kcl_lib::ast::types::LiteralIdentifier;
use kcl_lib::ast::types::LiteralValue;

use crate::CompileError;
use crate::KclFunction;

use super::native_functions;
use super::Address;

use std::collections::HashMap;

/// KCL values which can be written to KCEP memory.
/// This is recursive. For example, the bound value might be an array, which itself contains bound values.
#[derive(Debug, Clone)]
#[cfg_attr(test, derive(Eq, PartialEq))]
pub enum EpBinding {
    /// A KCL value which gets stored in a particular address in KCEP memory.
    Single(Address),
    /// A sequence of KCL values, indexed by their position in the sequence.
    Sequence(Vec<EpBinding>),
    /// A sequence of KCL values, indexed by their identifier.
    Map(HashMap<String, EpBinding>),
    /// Not associated with a KCEP address.
    Function(KclFunction),
}

impl From<KclFunction> for EpBinding {
    fn from(f: KclFunction) -> Self {
        Self::Function(f)
    }
}

impl EpBinding {
    /// Look up the given property of this binding.
    pub fn property_of(&self, property: LiteralIdentifier) -> Result<&Self, CompileError> {
        match property {
            LiteralIdentifier::Identifier(_) => todo!("Support identifier properties"),
            LiteralIdentifier::Literal(litval) => match litval.value {
                // Arrays can be indexed by integers.
                LiteralValue::IInteger(i) => match self {
                    EpBinding::Sequence(seq) => {
                        let i = usize::try_from(i).map_err(|_| CompileError::InvalidIndex(i.to_string()))?;
                        seq.get(i).ok_or(CompileError::IndexOutOfBounds { i, len: seq.len() })
                    }
                    EpBinding::Map(_) => Err(CompileError::CannotIndex),
                    EpBinding::Single(_) => Err(CompileError::CannotIndex),
                    EpBinding::Function(_) => Err(CompileError::CannotIndex),
                },
                // Objects can be indexed by string properties.
                LiteralValue::String(property) => match self {
                    EpBinding::Single(_) => Err(CompileError::NoProperties),
                    EpBinding::Function(_) => Err(CompileError::NoProperties),
                    EpBinding::Sequence(_) => Err(CompileError::ArrayDoesNotHaveProperties),
                    EpBinding::Map(map) => map.get(&property).ok_or(CompileError::UndefinedProperty { property }),
                },
                // It's never valid to index by a fractional number.
                LiteralValue::Fractional(num) => Err(CompileError::InvalidIndex(num.to_string())),
            },
        }
    }
}

/// A set of bindings in a particular scope.
/// Bindings are KCL values that get "compiled" into KCEP values, which are stored in KCEP memory
/// at a particular KCEP address.
/// Bindings are referenced by the name of their KCL identifier.
///
/// KCL has multiple scopes -- each function has a scope for its own local variables and parameters.
/// So when referencing a variable, it might be in this scope, or the parent scope. So, each environment
/// has to keep track of parent environments. The root environment has no parent, and is used for KCL globals
/// (e.g. the prelude of stdlib functions).
///
/// These are called "Environments" in the "Crafting Interpreters" book.
#[derive(Debug)]
pub struct BindingScope {
    // KCL value which are stored in EP memory.
    ep_bindings: HashMap<String, EpBinding>,
    /// KCL functions. They do NOT get stored in EP memory.
    parent: Option<Box<BindingScope>>,
}

impl BindingScope {
    /// The parent scope for every program, before the user has defined anything.
    /// Only includes some stdlib functions.
    /// This is usually known as the "prelude" in other languages. It's the stdlib functions that
    /// are already imported for you when you start coding.
    pub fn prelude() -> Self {
        Self {
            // TODO: Actually put the stdlib prelude in here,
            // things like `startSketchAt` and `line`.
            ep_bindings: HashMap::from([
                ("id".into(), EpBinding::from(KclFunction::Id(native_functions::Id))),
                ("add".into(), EpBinding::from(KclFunction::Add(native_functions::Add))),
            ]),
            parent: None,
        }
    }

    /// Add a new scope, e.g. for new function calls.
    #[allow(dead_code)] // TODO: when we implement function expressions.
    pub fn add_scope(self) -> Self {
        Self {
            ep_bindings: Default::default(),
            parent: Some(Box::new(self)),
        }
    }

    //// Remove a scope, e.g. when exiting a function call.
    #[allow(dead_code)] // TODO: when we implement function expressions.
    pub fn remove_scope(self) -> Self {
        *self.parent.unwrap()
    }

    /// Add a binding (e.g. defining a new variable)
    pub fn bind(&mut self, identifier: String, binding: EpBinding) {
        self.ep_bindings.insert(identifier, binding);
    }

    /// Look up a binding.
    pub fn get(&self, identifier: &str) -> Option<&EpBinding> {
        if let Some(b) = self.ep_bindings.get(identifier) {
            // The name was found in this scope.
            Some(b)
        } else if let Some(ref parent) = self.parent {
            // Check the next scope outwards.
            parent.get(identifier)
        } else {
            // There's no outer scope, and it wasn't found, so there's nowhere else to look.
            None
        }
    }

    /// Look up a function bound to the given identifier.
    pub fn get_fn(&self, identifier: &str) -> GetFnResult {
        if let Some(x) = self.get(identifier) {
            match x {
                EpBinding::Function(f) => GetFnResult::Found(f),
                _ => GetFnResult::NonCallable,
            }
        } else if let Some(ref parent) = self.parent {
            parent.get_fn(identifier)
        } else {
            GetFnResult::NotFound
        }
    }
}

pub enum GetFnResult<'a> {
    Found(&'a KclFunction),
    NonCallable,
    NotFound,
}
