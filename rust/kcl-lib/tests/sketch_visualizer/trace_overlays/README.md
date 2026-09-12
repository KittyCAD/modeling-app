# Trace-backed overlay regression fixtures

These are real Zookeeper checkpoints, not generated examples or new eval items.
Each file is the unchanged source prefix through the requested top-level sketch
or region declaration, extracted using MCP's `_source_through_sketch`. Later
declarations were omitted to isolate rendering from downstream modeling errors.
No coordinates, constraints, region arguments, or seed names were rewritten.
The table includes both the full recorded source revision and fixture hash.

- Case Cover: [trace 01a073ce-f333-772e-8893-981425ccec0d](https://www.comet.com/opik/zookeeper/projects/019c72bb-b1bb-7633-849d-007f7e84b9b2/logs?trace=01a073ce-f333-772e-8893-981425ccec0d),
  [workflow 33996386838](https://github.com/KittyCAD/text-to-cad-eval/actions/runs/33996386838),
  artifact `controlled-sketch-repair-candidate-2`.
- Ceiling Tile Hanger: [trace 01a073bb-0e4d-7c5e-b9b4-3ac9c5b1d696](https://www.comet.com/opik/zookeeper/projects/019c72bb-b1bb-7633-849d-007f7e84b9b2/logs?trace=01a073bb-0e4d-7c5e-b9b4-3ac9c5b1d696),
  [workflow 33996388007](https://github.com/KittyCAD/text-to-cad-eval/actions/runs/33996388007),
  artifact `controlled-sketch-repair-candidate-1`.

Frame numbers are zero-based indexes in the saved `response.json` stream;
images are named `zk-stream-NNNN-00-sketch-visualization.png`.

| Fixture | Stream frame | Tool call ID | Full source SHA-256 | Fixture SHA-256 |
| --- | --- | --- | --- | --- |
| case_cover_0009.kcl | 9 | `call_MwmiLhqkAwcWRSYV9SW4vJHr` | `e5086cecb6623f4b8f85619073e471cb9cc5ce1042ef2299b3271a892d1fac33` | `bb9106d503d389819a8ffd7f1469b532bbd0c23cd79f91336632a157bd965421` |
| case_cover_0034.kcl | 34 | `call_xvfTPoQC80wkFItm7lr4yHYc` | `dd1abad185a5e7ed0364bc7e881faf85fe59597d3aca975685f5b8d765180d28` | `8dfdc878a4b89dbbf606a0db9eb250b7c682e53fd06262c83758f28948282f48` |
| case_cover_0055.kcl | 55 | `call_naPVaLCXGveUZG3F6EqvFO33` | `e592dda89c3cdb69414859ac753bc9849b7365cb9ef9cb29df7bb772055c9a23` | `07f889ad9bfccee04038a6476c9320f947910f74e3b81c2bf3a20c2e916f41d3` |
| case_cover_0126.kcl | 126 | `call_c8DJdKZIfgihrQ7D6Vjo27GQ` | `70f96958fcaf4a989ce8716981947c6cf6a9afc6828ba2df8d75b0ba3965cf86` | `48aad6ad4bbe61fb4bbca603786dd743351929272b64ca97d0956334b8a21c9d` |
| ceiling_tile_hanger_0054.kcl | 54 | `call_vMklmNlP7vMPD6R2zBD040Jm` | `00dfd61d54715651b45a5dda438570498a61f9fc46c1d8bf9bacf60fe4fa61ea` | `1b101be0fb1598e608c8fc2886db8594573328616c4e858ca91e0d89cceb0a0f` |

## What is verified

`engine_trace_checkpoint_overlays` executes these prefixes with the real engine,
captures trimmed region contours, and renders with the recorded seed selection.

- Frame 9 selects the large central region (about 34.12194 square inches).
- Frames 34, 55, and 126 select a small circular cap of the right blend
  (about 0.0709887 square inches), not the whole intended ear.
  The original PNGs contain respectively 390, 390, and 506 green pixels.
  These fills are small, not absent or zero-area. The regression checks both
  contour coordinates/area and bounded visible fill size, not just PNG success.
- Hanger frame 54 requests highlights without a resolved region and must not fill.
- Every existing blue/white/red line or point pixel must retain its constraint
  color when overlays are added.

Run from `rust/` with engine credentials:
`cargo test -p kcl-lib engine_trace_checkpoint_overlays --lib`.
These tests do not invoke Zookeeper, change dataset items, or calculate eval scores.
