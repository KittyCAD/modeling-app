# Legacy sketch engine cassettes

`modelingMachine.legacySketch.spec.ts` replays typed results from normal engine
execution. It keeps the real modeling machine, guards, AST transformations,
selection handling, editor updates, camera transition, and client-side sketch
construction. Only execution results and acknowledged scene commands are supplied
by the fixture adapter. Both Wasm execution entry points are guarded: the offline
suite must call neither the normal engine executor nor the KCL mock executor.
Existing production calls through `RustContext.executeMock` receive recorded data
at that JavaScript boundary; they never enter the deprecated interpreter mode.

`modelingMachine.legacySketch.engineResults.ts` currently records 144 requests
sharing 70 distinct result payloads. Each payload contains only the variables,
artifact relationships/source references, and default planes used by sketch
editing. The generation helpers share captured literals; they compute no geometry.
Replay deep-clones the payload so app code cannot modify another case's inputs.

Lookup includes the requested AST's source locations. A partial redraw also
includes its surrounding program in the key, because it depends on bindings
outside the sketch statement. Unknown requests fail, including requests whose
formatting changed source offsets. An unknown request never falls through to a
network request or an interpreter.

The eight cases in `modelingMachine.legacySketch.engine.spec.ts` compare one real
producer result per geometry family against the cassettes. Comparisons retain
geometry and source relationships while ignoring generated engine identifiers.
The two swept-face cases in `modelingMachine.spec.ts` still verify actual face
orientation, sketch creation, and reload. This is contract coverage, not a complete
geometry-kernel test suite.

## Updating cassettes

Update only when the example programs or their runtime contract intentionally
change. A built Wasm blob and an engine token are required to record. Recording
uses normal execution on the real engine, including for legacy redraw requests:
those partial statements are executed with their complete surrounding program.
The recorder rejects a partial statement that does not belong to that program.

From the repository root:

```sh
ZDS_RECORD_SKETCH_ENGINE_RESULTS=1 npm run test:integration -- \
  src/machines/modelingMachine.legacySketch.spec.ts --retry=0 --maxWorkers=1
python3 scripts/generate-legacy-sketch-engine-fixtures.py \
  /tmp/zds-sketch-engine-results.json
npx biome check --write --formatter-enabled=true --linter-enabled=false \
  --assist-enabled=false src/machines/modelingMachine.legacySketch.engineResults.ts
```

Inspect the generated diff. Rerun the offline suite with recording disabled, then
run the eight producer contracts and the two swept-face contracts against the
engine. Ordinary test and verification commands never update the cassettes.
