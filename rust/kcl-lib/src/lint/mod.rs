pub mod checks;
mod rule;

pub use rule::{Discovered, Finding, Rule, lint_and_fix};
