use indexmap::IndexMap;

pub type Label = char;

/// The value of each variable in an equation.
pub type Vars = IndexMap<Label, f64>;

type Result<T> = std::result::Result<T, Error>;

#[derive(Debug, PartialEq)]
pub struct Eval {
    /// The value of the equation.
    value: f64,
    /// All derivatives of all variables.
    derivatives: Vars,
}

/// Symbolic equation that can be evaluated.
pub struct Equation {
    eval: Box<dyn Fn(Vars) -> Result<Eval>>,
}

/// Errors that could occur.
#[derive(Debug)]
pub enum Error {
    MissingVariable(Label),
}

impl Equation {
    /// The simplest kind of equation, a single variable.
    /// E.g. `x`.
    pub fn single_variable(label: Label) -> Self {
        let eval = move |vars: Vars| {
            let Some(var_value) = vars.get(&label) else {
                return Err(Error::MissingVariable(label.clone()));
            };

            // Reuse the input variables map as the output derivatives map.
            let var_value = *var_value;
            let mut derivatives = vars;
            derivatives[&label] = 1.0;

            // All done.
            Ok(Eval {
                value: var_value,
                derivatives,
            })
        };
        Self { eval: Box::new(eval) }
    }

    pub fn evaluate(&self, vars: Vars) -> Result<Eval> {
        (self.eval)(vars)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_basics() {
        let actual = Equation::single_variable('a')
            .evaluate(Vars::from([('a', 14.0)]))
            .unwrap();
        let expected = Eval {
            value: 14.0,
            derivatives: IndexMap::from([('a', 1.0)]),
        };
        assert_eq!(actual, expected,);
    }
}
