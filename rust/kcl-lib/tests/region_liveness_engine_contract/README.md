# Region liveness engine contract fixtures

These KCL files pin the modeling engine's current ownership behavior for regions.
Some modeling operations consume a region, so the engine rejects a second use of
that region. Other operations only reference a region and leave it reusable.

This distinction is part of the information KCL needs to track region liveness.
If the engine changes which operations consume regions, the KCL liveness rules
must be reviewed and updated before that engine change is accepted. Otherwise,
KCL could reject a valid reuse or allow a reuse that will fail in the engine.

The tests are implemented in
`rust/kcl-lib/src/simulation_tests.rs` in the
`region_liveness_engine_contract` module. Any change to the pinned behavior fails
with this diagnostic:

```text
THE KCL LOGIC FOR LIVENESS OF REGIONS NEEDS TO BE UPDATED BEFORE ACCEPTING THIS ENGINE CHANGE.
```

## Consumed-region fixtures

Each consumed-region fixture performs the operation once. The Rust test harness
captures the raw modeling command and sends it to the engine a second time. This
intentionally bypasses KCL-side liveness checks, ensuring that these tests
continue to measure the engine contract after KCL liveness checking is added or
changed.

| Fixture | Region use pinned by the test |
| --- | --- |
| `input.kcl` | `extrude` target is consumed |
| `twist_extrude.kcl` | `twistExtrude` target is consumed |
| `extrude_to_reference.kcl` | `extrudeToReference` target is consumed |
| `revolve.kcl` | `revolve` target is consumed |
| `revolve_about_edge.kcl` | `revolveAboutEdge` target is consumed |
| `sweep_profile.kcl` | `sweep` profile is consumed |

The tests also pin the engine error returned by each repeated command. A changed
error is treated as a contract change because it may indicate different engine
ownership behavior or require different KCL error handling.

## Reusable-region fixtures

Each reusable-region fixture performs both uses in KCL. Successful execution
pins that the engine permits the same region to participate in both operations.

| Fixture | Region use pinned by the test |
| --- | --- |
| `sweep_trajectory.kcl` | A sweep trajectory can be reused |
| `loft_sections.kcl` | Loft section regions can be reused |
| `subtract2d_target.kcl` | A `subtract2d` target can be reused |
| `subtract2d_tool.kcl` | A `subtract2d` tool can be reused |

## Running the contract tests

Run these tests from `rust/` with an engine-enabled environment:

```sh
direnv exec .. cargo nextest run --retries 3 --no-fail-fast -p kcl-lib --locked -- region_liveness_engine_contract
```

Do not update a failing fixture or its expected error merely to accept new
engine output. First determine whether the engine's region ownership behavior
changed, then update the KCL liveness logic and this contract together.
