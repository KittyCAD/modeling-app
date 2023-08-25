//! Functions for generating docs for our stdlib functions.

/// This struct defines a single argument to a stdlib function.
#[allow(dead_code)]
pub struct StdLibFnArg {
    /// The name of the argument.
    pub name: String,
    /// The type of the argument.
    pub type_: String,
    /// The description of the argument.
    pub description: String,
    /// The schema of the argument.
    pub schema: schemars::schema::Schema,
    /// If the argument is required.
    pub required: bool,
}

/// This trait defines functions called upon stdlib functions to generate
/// documentation for them.
pub trait StdLibFn {
    /// The name of the function.
    fn name(&self) -> String;

    /// The summary of the function.
    fn summary(&self) -> String;

    /// The description of the function.
    fn description(&self) -> String;

    /// The tags of the function.
    fn tags(&self) -> Vec<String>;

    /// The args of the function.
    fn args(&self) -> Vec<StdLibFnArg>;

    /// The return value of the function.
    fn return_value(&self) -> StdLibFnArg;

    /// If the function is unpublished.
    fn unpublished(&self) -> bool;

    /// If the function is deprecated.
    fn deprecated(&self) -> bool;

    /// The function itself.
    fn std_lib_fn(&self) -> crate::std::StdFn;
}
