# getCommonEdge engine contract

These fixtures pin the mock/real execution parity contract for
`getCommonEdge`: mock execution must accept and reject the same programs
as real execution, with the same error. Each fixture is executed by
`src/engine_contracts/get_common_edge.rs` through both
mock execution and the real engine.

The expectations encode the engine-validated behavior of real execution,
including cases where real execution rejects face tags that a human
might consider valid (for example, carried face tags on a CSG result
still name the consumed source body). If a change makes real execution
accept more of these programs, update the expectations here so mock
execution follows along.
