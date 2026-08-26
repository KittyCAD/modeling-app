//! Engine contract tests: each module runs fixtures through both mock
//! execution and the real engine and asserts the outcomes are equal, so
//! mock/real behavior drift fails loudly. Unlike `simulation_tests`, these
//! are not snapshot tests.

mod get_common_edge;
