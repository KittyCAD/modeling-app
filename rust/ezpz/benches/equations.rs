use kcl_ezpz::equations::{Equation, Vars};

fn main() {
    // Run registered benchmarks.
    divan::main();
}

#[divan::bench(args = [1.0, 2.0, 4.0])]
fn multiplied(n: f64) -> f64 {
    let equation = (Equation::single_variable('a') + Equation::single_variable('a') + Equation::single_variable('b'))
        * Equation::single_variable('a');

    let actual = equation.evaluate(&Vars::from([('a', n), ('b', 2.0)])).unwrap();
    actual.value
}
