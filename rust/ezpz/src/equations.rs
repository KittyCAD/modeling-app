use indexmap::IndexMap;

pub type Label = char;

/// The value of each variable in an equation.
pub type Vars = IndexMap<Label, f64>;

type Result<T> = std::result::Result<T, Error>;

pub trait Equation {
    /// You can evaluate an equation by supplying the value of each variable.
    fn evaluate(&self, vars: Vars) -> Result<Eval>;
}

#[derive(Debug, PartialEq)]
pub struct Eval {
    /// The value of the equation.
    value: f64,
    /// All derivatives of all variables.
    derivatives: Vars,
}

/// The simplest kind of equation, a single variable.
/// E.g. `x`.
struct SingleVar {
    label: Label,
}

/// Errors that could occur.
#[derive(Debug)]
pub enum Error {
    MissingVariable(Label),
}

impl Equation for SingleVar {
    fn evaluate(&self, vars: Vars) -> Result<Eval> {
        // Evaluate the single variable by just looking up its value.
        let Some(var_value) = vars.get(&self.label) else {
            return Err(Error::MissingVariable(self.label.clone()));
        };

        // Reuse the input variables map as the output derivatives map.
        let var_value = *var_value;
        let mut derivatives = vars;
        derivatives[&self.label] = 1.0;

        // All done.
        Ok(Eval {
            value: var_value,
            derivatives,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basics() {
        let actual = SingleVar { label: 'a' }.evaluate(Vars::from([('a', 14.0)])).unwrap();
        let expected = Eval {
            value: 14.0,
            derivatives: IndexMap::from([('a', 1.0)]),
        };
        assert_eq!(actual, expected,);
    }
}
