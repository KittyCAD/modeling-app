# Region liveness engine contract tests

## Why these tests exist

Some engine operations consume a Region's profile. Afterward, another
profile-consuming operation cannot use that Region. Other operations only
reference the Region and leave it reusable.

KCL tracks this distinction so it can report a useful diagnostic before sending
an invalid command to the engine. The rules in KCL must therefore match the
engine's ownership behavior. These tests prevent an engine change from silently
making the KCL rules stale.

The `.kcl` files in this directory create the geometry needed by the contract
tests. The Rust assertions are in
`rust/kcl-lib/src/simulation_tests/region_liveness_engine_contract.rs`.

## What the tests protect

The tests verify which Region inputs are:

- consumed by `extrude`, `revolve`, `sweep`, and `delete`;
- reusable by operations that only reference a Region;
- independently consumable when separate `region(...)` calls use the same
  original sketch; and
- handled consistently by mock and real execution.

They also cover duplicate Region arguments, combinations of different consuming
commands, and a Region used in more than one argument role in the same command.
Where necessary, the Rust harness sends raw modeling commands so a KCL liveness
check cannot hide a change in engine behavior.

## When a contract test fails

A contract failure means the engine response no longer matches the behavior on
which KCL's Region-liveness rules are based. It must not be fixed by only
changing the expected response or accepting new test output.

1. Re-run the failing test with an engine-enabled environment and identify the
   modeling command, the Region's argument role, and the engine's new response.
2. Determine whether the engine now consumes a previously reusable Region,
   preserves a previously consumed Region, or has only changed its error.
3. If the ownership change is unintended, fix or reject the engine change. Do
   not change KCL's liveness rules.
4. If the ownership change is intentional, update the KCL Region policy and its
   mock tests first. Then update the engine-contract assertion and this README
   in the same change.
5. Verify that mock and real execution still produce matching KCL diagnostics.

Contract failures use this message to make that requirement explicit:

```text
THE KCL LOGIC FOR LIVENESS OF REGIONS NEEDS TO BE UPDATED BEFORE ACCEPTING THIS ENGINE CHANGE.
```

Do not enrich a later engine error as a substitute for updating the liveness
rule. KCL should diagnose stale Regions before making the engine call.

## Fixture guide

| Fixtures | Contract covered |
| --- | --- |
| `input.kcl`, `twist_extrude.kcl`, `extrude_to_reference.kcl`, `revolve*.kcl`, `sweep_profile.kcl`, `delete_target.kcl` | A second consuming command cannot reuse the Region; `delete` removes it |
| `mixed_profile_consumers_source.kcl` | All ordered pairs of different consuming commands, including `delete`, and the multiple-`region(...)` workaround |
| `duplicate_*.kcl` | Duplicate Region inputs to one KCL call |
| `same_region_multiple_roles_source.kcl` | One Region used in consuming and reusable argument roles in the same engine command |
| Reusable-operation fixtures such as `loft_sections.kcl`, `pattern_*_source.kcl`, and `transform_source.kcl` | Operations that must leave their Region input reusable |
| `interpreter_warning_parity.kcl`, `interpreter_error_parity.kcl` | Matching liveness diagnostics in mock and real execution |
| `clone_source.kcl` | The known independent `clone(Region)` engine failure; source reusability remains unverified while cloning is broken |

The supported workaround for multiple consuming operations is to call
`region(...)` separately for each operation using the original sketch. Do not
clone the sketch.

## Running the tests

From `rust/`:

```sh
direnv exec .. cargo nextest run --retries 3 --no-fail-fast -p kcl-lib --locked -- region_liveness_engine_contract
```

These tests use the real engine and require `ZOO_API_TOKEN`. Let `direnv` load
the complete worktree environment as shown above.
