use kcl_ezpz::equations::{Equation, Label, Vars};

fn main() {
    // Run registered benchmarks.
    divan::main();
}
// Convenient shorthand for 'variable', to make tests nicer.
#[inline(always)]
fn v(label: Label) -> Equation {
    Equation::single_variable(label)
}

// Convenient shorthand for 'constant', to make tests nicer.
#[inline(always)]
fn c(constant: f64) -> Equation {
    Equation::constant(constant)
}

#[divan::bench(args = [1.0, 2.0, 4.0])]
fn multiplied(n: f64) -> f64 {
    let equation = (v('a') + v('a') + v('b')) * (v('a') - c(3.0));

    let actual = equation.evaluate(&Vars::from([('a', n), ('b', 2.0)])).unwrap();
    actual.value
}
