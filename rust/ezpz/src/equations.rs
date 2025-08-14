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
    eval: Box<dyn FnOnce(&Vars) -> Result<Eval>>,
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
        let eval = move |vars: &Vars| {
            let Some(var_value) = vars.get(&label).copied() else {
                return Err(Error::MissingVariable(label));
            };

            let mut derivatives = Vars::with_capacity(1);
            derivatives.insert(label, 1.0);

            // All done.
            Ok(Eval {
                value: var_value,
                derivatives,
            })
        };
        Self { eval: Box::new(eval) }
    }

    pub fn evaluate(self, vars: &Vars) -> Result<Eval> {
        (self.eval)(vars)
    }
}

impl std::ops::Add for Equation {
    type Output = Self;

    fn add(self, rhs: Self) -> Self::Output {
        let eval = |vars: &Vars| {
            let a = self;
            let b = rhs;
            let Eval {
                value: ra,
                derivatives: das,
            } = a.evaluate(vars)?;
            let Eval {
                value: rb,
                derivatives: dbs,
            } = b.evaluate(vars)?;
            let mut derivatives = Vars::with_capacity(das.len() + dbs.len());
            for d in das {
                *derivatives.entry(d.0).or_insert(0.0) += d.1;
            }
            for d in dbs {
                *derivatives.entry(d.0).or_insert(0.0) += d.1;
            }
            Ok(Eval {
                value: ra + rb,
                derivatives,
            })
        };
        Self { eval: Box::new(eval) }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn eval_single_var() {
        let equation = Equation::single_variable('a');

        let actual = equation.evaluate(&Vars::from([('a', 14.0)])).unwrap();
        let expected = Eval {
            value: 14.0,
            derivatives: IndexMap::from([('a', 1.0)]),
        };
        assert_eq!(actual, expected,);
    }

    #[test]
    fn eval_two_vars() {
        let equation = Equation::single_variable('a') + Equation::single_variable('b');

        let actual = equation.evaluate(&Vars::from([('a', 14.0), ('b', 2.0)])).unwrap();
        let expected = Eval {
            value: 16.0,
            derivatives: IndexMap::from([('a', 1.0), ('b', 1.0)]),
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn eval_same_var_added() {
        let equation = Equation::single_variable('a') + Equation::single_variable('a') + Equation::single_variable('b');

        let actual = equation.evaluate(&Vars::from([('a', 14.0), ('b', 3.0)])).unwrap();
        let expected = Eval {
            value: 31.0,
            derivatives: IndexMap::from([('a', 2.0), ('b', 1.0)]),
        };
        assert_eq!(actual, expected);
    }
}
