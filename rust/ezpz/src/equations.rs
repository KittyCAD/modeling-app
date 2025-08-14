use indexmap::IndexMap;

pub type Label = char;

/// The value of each variable in an equation.
pub type Vars = IndexMap<Label, f64>;

type Result<T> = std::result::Result<T, Error>;

/// Result of evaluating an equation.
#[derive(Debug, PartialEq)]
pub struct Eval {
    /// The value of the equation.
    pub value: f64,
    /// All derivatives of all variables.
    pub derivatives: Vars,
}

/// This is basically a newtype for
/// `FnOnce(&Vars) -> Result<Eval>`.
trait Evaluate: FnOnce(&Vars) -> Result<Eval> {}
impl<F> Evaluate for F where F: FnOnce(&Vars) -> Result<Eval> {}

/// Symbolic equation that can be evaluated.
pub struct Equation {
    eval: Box<dyn Evaluate>,
}

/// Errors that could occur.
#[derive(Debug)]
pub enum Error {
    MissingVariable(Label),
}

impl Equation {
    /// Simplest equation: a constant.
    /// Does not depend on input variables at all.
    pub fn constant(value: f64) -> Self {
        let eval = move |_vars: &Vars| {
            let derivatives = Vars::new();
            Ok(Eval { value, derivatives })
        };
        Self { eval: Box::new(eval) }
    }

    /// Simple equation with a single variable.
    /// E.g. `x`.
    pub fn single_variable(label: Label) -> Self {
        let eval = move |vars: &Vars| {
            let Some(var_value) = vars.get(&label).copied() else {
                return Err(Error::MissingVariable(label));
            };

            let mut derivatives = Vars::with_capacity(1);
            derivatives.insert(label, 1.0);

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
            let derivatives = union_with(das, dbs, |a, b| a + b);
            Ok(Eval {
                value: ra + rb,
                derivatives,
            })
        };
        Self { eval: Box::new(eval) }
    }
}

impl std::ops::Mul for Equation {
    type Output = Self;

    fn mul(self, rhs: Self) -> Self::Output {
        let eval = |vars: &Vars| {
            let a = self;
            let b = rhs;
            let Eval {
                value: ra,
                derivatives: mut das,
            } = a.evaluate(vars)?;
            let Eval {
                value: rb,
                derivatives: mut dbs,
            } = b.evaluate(vars)?;
            // Product rule. Reuse storage for derivatives of A and B
            // so we don't have to reallocate. This saves 30% of time
            // when evaluating on our benchmarks, compared to
            // mapping over the dict and recollecting.
            das.values_mut().for_each(|x| *x *= rb);
            dbs.values_mut().for_each(|x| *x *= ra);
            let derivatives = union_with(das, dbs, |a, b| a + b);
            Ok(Eval {
                value: ra * rb,
                derivatives,
            })
        };
        Self { eval: Box::new(eval) }
    }
}

impl std::ops::Div for Equation {
    type Output = Self;

    fn div(self, rhs: Self) -> Self::Output {
        let eval = |vars: &Vars| {
            let a = self;
            let b = rhs;
            let Eval {
                value: ra,
                derivatives: mut das,
            } = a.evaluate(vars)?;
            let Eval {
                value: rb,
                derivatives: mut dbs,
            } = b.evaluate(vars)?;
            // Quotient rule. Reuse storage for derivatives of A and B
            // so we don't have to reallocate. This saves 30% of time
            // when evaluating on our benchmarks, compared to
            // mapping over the dict and recollecting.
            das.values_mut().for_each(|x| *x *= rb);
            dbs.values_mut().for_each(|x| *x *= -ra);
            let mut derivatives = union_with(das, dbs, |a, b| a + b);
            let rb_squared = rb.powf(2.0);
            derivatives.values_mut().for_each(|x| *x /= rb_squared);
            Ok(Eval {
                value: ra / rb,
                derivatives,
            })
        };
        Self { eval: Box::new(eval) }
    }
}

impl std::ops::Neg for Equation {
    type Output = Self;

    fn neg(self) -> Self::Output {
        let eval = |vars: &Vars| {
            let a = self;
            let Eval {
                value: r,
                mut derivatives,
            } = a.evaluate(vars)?;
            derivatives.values_mut().for_each(|d| *d = d.neg());
            Ok(Eval { value: -r, derivatives })
        };
        Self { eval: Box::new(eval) }
    }
}

/// Union two maps. If a value appears in both maps,
/// pass both instances into `f` and insert that value.
fn union_with<K: std::hash::Hash + Eq, V: Copy>(
    a: IndexMap<K, V>,
    b: IndexMap<K, V>,
    f: impl Fn(V, V) -> V,
) -> IndexMap<K, V> {
    let mut out = a;
    out.reserve(b.len());
    for (b_key, b_val) in b {
        if let Some(a_val) = out.get(&b_key) {
            // TODO: This requires a copy unfortunately.
            // Can probably remove it if we stop using IndexMap.
            out.insert(b_key, f(*a_val, b_val));
        } else {
            out.insert(b_key, b_val);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    // Convenient shorthand for 'variable', to make tests nicer.
    fn v(label: Label) -> Equation {
        Equation::single_variable(label)
    }

    // Convenient shorthand for 'constant', to make tests nicer.
    fn c(constant: f64) -> Equation {
        Equation::constant(constant)
    }

    // Convenience to make tests nicer
    fn vars(s: &str) -> Vars {
        let mut vars = Vars::new();
        for assign in s.replace(' ', "").split(',') {
            let (label, value) = assign.split_once('=').unwrap();
            let label = label.chars().next().unwrap();
            let value = value.parse().unwrap();
            vars.insert(label, value);
        }
        vars
    }

    #[test]
    fn eval_single_var() {
        let equation = v('a');

        let actual = equation.evaluate(&vars("a=14")).unwrap();
        let expected = Eval {
            value: 14.0,
            derivatives: vars("a=1"),
        };
        assert_eq!(actual, expected,);
    }

    #[test]
    fn eval_two_vars() {
        let equation = v('a') + v('b');

        let actual = equation.evaluate(&vars("a=14,b=2")).unwrap();
        let expected = Eval {
            value: 16.0,
            derivatives: vars("a=1,b=1"),
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn eval_same_var_added() {
        let equation = v('a') + v('a') + v('b');

        let actual = equation.evaluate(&vars("a=14, b=3")).unwrap();
        let expected = Eval {
            value: 31.0,
            derivatives: vars("a=2, b=1"),
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn eval_divided() {
        let equation = (v('a') + v('a') + v('b')) / v('a');

        let actual = equation.evaluate(&vars("a=3,b=2")).unwrap();
        let expected = Eval {
            value: 8.0 / 3.0,
            derivatives: IndexMap::from([('a', -2.0 / 9.0), ('b', 1.0 / 3.0)]),
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn eval_with_constant() {
        // Basically (x + 5) * (x + y)
        let equation = (v('x') + c(5.0)) * (v('x') + v('y'));

        let actual = equation.evaluate(&vars("x=2,y=3")).unwrap();
        let expected = Eval {
            value: 35.0,
            derivatives: vars("x=12, y=7"),
        };
        assert_eq!(actual, expected);
    }

    #[test]
    fn eval_negated() {
        // These two should be equivalent.
        let equation0 = -v('x');
        let equation1 = v('x') * c(-1.0);

        // So their evaluations should be equivalent.
        let actual0 = equation0.evaluate(&vars("x=2")).unwrap();
        let actual1 = equation1.evaluate(&vars("x=2")).unwrap();

        let expected = Eval {
            value: -2.0,
            derivatives: vars("x=-1"),
        };
        assert_eq!(actual0, expected);
        assert_eq!(actual1, expected);
    }
}
