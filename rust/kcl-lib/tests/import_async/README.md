# Async import completion regression

`kcl_test_execute` keeps the original STL screw, concurrent helical-gear work,
translation, image, artifact, and physical-property snapshots.

`kcl_test_completed_import_bounds` checks the completion contract before any
camera, snapshot, export, or idle-wait can refresh the scene bounds:

1. Execute `completion.kcl` once in a fresh Engine session. It creates a native
   cuboid at `(0,0,0)..(2,3,4)` mm and imports `completion.obj`, a cuboid at
   `(10,20,30)..(12,23,34)` mm. The imported value is not transformed or otherwise
   used by a command that would independently wait for its response. KCL
   completion must include it. Immediately query the scene: center
   `(6,11.5,17)`, dimensions `(12,23,34)` mm.
2. With that cache populated, asynchronously import a second copy whose X
   coordinates have been translated by 100 mm. Wait for async command
   completion, then query the scene before querying the individual object.
   Expect center `(56,11.5,17)`, dimensions `(112,23,34)` mm. The explicit object
   must have center `(111,21.5,32)`, dimensions `(2,3,4)` mm.
3. Check the native cuboid's area, `2*(2*3+2*4+3*4)=52 mm2`, and mass,
   `2*3*4=24 mm3` at `1000 kg/m3`, or `0.024 g`. The current physics contract
   measures B-rep solids; OBJ meshes contribute to scene bounds but not solid
   export. This test preserves that distinction.

The numerical allowance is `1e-9 + 64*f32::EPSILON*abs(expected)`: a small
absolute floor plus float32 accumulation/conversion allowance for a cuboid's
12 triangles. Missing objects, stale scene dimensions, and incorrect units
remain failures. The test has no retries, snapshot updates, sleeps, or skips.

Run from `rust/` with the appropriate Engine endpoint and credential:

```sh
INSTA_UPDATE=no cargo nextest run -p kcl-lib --features artifact-graph \
  --retries 0 -E 'test(=simulation_tests::import_async::kcl_test_completed_import_bounds)'
```

Modeling App's recursive and machine executor CI paths include this test.
Engine's KCL shards also select it through their `kcl_test` name filter after
the source is included in Modeling App main. Exact binary/fixture pairing for
those cross-repository jobs is tracked by
[Engine #5056](https://github.com/KittyCAD/engine/issues/5056) and
[PR #5057](https://github.com/KittyCAD/engine/pull/5057).

The stale-cache repair remains
[Engine #5010](https://github.com/KittyCAD/engine/issues/5010) /
[PR #5044](https://github.com/KittyCAD/engine/pull/5044). This regression must pass
against that repair before landing.

The screw-and-gear snapshot uses recomputed bounds of approximately
`46.229 x 96.511 x 13.635` mm. Neither historical result was correct: the
`100 x 113.5 x 13.635` box included a stale 100 mm plane and the screw's old
position, while `100 x 100 x 7` also missed the screw. Its STL coordinates run
from `(-6.635,-8,-6.635)` to `(6.635,63.5,6.635)` mm; the final `translate(y=10)`
moves the top Y extent to 73.5 mm. The recomputed scene bounds retain that extent
and the lofted gear while excluding hidden planes.

On 2026-09-07, forcing a bounds recomputation after the original program
completed produced exactly the four changed snapshot values, with identical
mass, surface area, and Z bounds. These also match Engine #5044's original
workflow attempt 1 (`33928086336`, shard 9, tested merge
`d519dbd9c1aa09fd52ceabec7b2a4668d71c0b5d`). The local diagnostic created and
removed a disposable hidden plane to trigger recomputation without changing
the model; that workaround is not part of either regression.

Verify both tests using the repaired Engine and a recorded KCL source revision
before restoring TAB blocking for Engine test 4884 and Modeling App test 1881.
