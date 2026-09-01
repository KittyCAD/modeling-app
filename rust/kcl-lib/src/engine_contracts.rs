//! Engine contract tests: each module runs fixtures through both mock
//! execution and the real engine and asserts the outcomes are equal, so
//! mock/real behavior drift fails loudly. Unlike `simulation_tests`, these
//! are not snapshot tests.
//!
//! Tests here should be run in the engine repo's CI, so their names must start
//! with `kcl_test_`. This also routes into the `uses-engine` nextest group (see
//! `rust/.config/nextest.toml`).

mod get_common_edge;
