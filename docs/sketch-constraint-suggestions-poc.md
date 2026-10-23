# Sketch constraint suggestions POC

This local experiment adds sketch constraint suggestions behind the
`sketch_experimental_features` flag. The draft PR's Vercel preview also
enables the POC automatically so reviewers can try it without an account flag.
The preview ranks solver-safe candidates with a small model trained on internal
KCL test fixtures; other builds use the rules order unless a local model is
loaded.
Selecting geometry starts a check after
350 ms; **Suggest** refreshes it manually. Click a suggestion to apply it.
Nothing is applied without that click.

## Try it locally

The browser checkout needs `VITE_ZOO_API_TOKEN` configured in
`.env.development.local` to reach the modeling scene.
Run `npm run build:wasm` and `npm start`, then paste this KCL into the editor:

```kcl
sketch(on = XY) {
  line(start = [var 0mm, var 0mm], end = [var 9.9mm, var 0.1mm])
}
```

Select the line. The near-horizontal line should offer
horizontal and a 10 mm length dimension. Then try these selections:

| Selection | Candidate |
| --- | --- |
| One nearly horizontal or vertical line | Horizontal or vertical |
| Two lines of similar length | Equal length |
| Two nearly parallel or perpendicular lines | Parallel or perpendicular |
| Two arcs or circles of similar radius | Equal radius |
| A line and a near-tangent circle or arc | Tangent |
| Two nearly externally tangent circles | Tangent |
| Two nearly mirrored points or circles and their axis line | Symmetric |
| One line, arc, or circle near a simple size | Length, radius, or diameter |

For an arc, the tangent contact must be near an arc endpoint. For symmetry,
the axis is the selected line. Three-line symmetry and internal circle
tangency are outside this experiment. Coincident and midpoint suggestions are
not generated yet, though the modeling app supports those manual tools.
Owned support lines are ignored.

The candidate generator uses geometric thresholds. It orders candidates by
normalized geometric residual, then previews each constraint
with the Rust sketch solver on a cloned frontend state and independent mock
engine and cache. The current program is rerun in that mock context for each
candidate, so preview latency may grow with project size. A failed solve,
conflicted point, invalidated object ID, or point movement above 5% of the
selected geometry size hides the candidate. Direct duplicates are hidden.
One-click acceptance sends the exact previewed payload to the sketch
machine, which checks that the selection and scene still match before using
the normal checkpoint and sketch outcome flow.

The POC preview uses the trained ranker to reorder the candidates that pass
the solver checks. The model does not construct constraint payloads or recover
candidate types the generator missed. It is a weak-label experiment, not a
validated design-intent model. CAD-reviewed labels are still needed before
using it outside the draft preview.

## Review source sketches

Open a source sketch, select geometry, press **Suggest**, then use
**Copy review template**. The copied JSON contains candidate type and three
numeric features, the exact suggested constraint payload, and selected entity
IDs. It does not contain the KCL source or sketch coordinates. It is not
stored by the app.

Create a local JSONL file with one completed template per selection. Fill in
`sample_id`, `project_family`, `source_ref` (the pinned Git path and hash from
the source inventory), and `reviewer`. Set
`expected_action` to `suggest` or `none`, explain that choice in
`review_reason`, and set each candidate's `label` to `accept` or `reject`
with a short `reason`. After changing a driving dimension, set
`dimension_edit` to `pass`, `fail`, or `not_tested`. A `suggest` example with
no accepted candidate records a candidate-generation miss. Avoid labeling
from user dismissal alone.

For an accepted candidate in the reviewed training set, fill the copied
`dimension_edit_probe` with the driver, before/after values, and relationship
that should remain true. The local data preparation step requires a pass or
fail outcome and these probe details before exporting training records.

Assign `train` or `test` to whole `project_family` groups. The evaluator also
rejects a `source_ref` that appears in both splits. Keep the review JSONL in a
local POC directory, outside this worktree. Run:

```sh
node scripts/sketch-constraint-eval.mjs /path/to/reviews.jsonl /path/to/local-model.json
```

The script requires complete CAD review fields, at least ten
train candidates with both labels, and a held-out test split. It reports the
rules baseline, learned top-one ranking, and ranking with a fixed 0.7
abstention threshold. It writes coefficients only to the requested local path.
Check test precision, intent recall, wrong-intent rate, candidate recall,
no-suggestion accuracy, dimension-edit coverage, and dimension-edit pass rate
before trying the model in the UI. The fixed threshold is
exploratory and needs calibration on more data.

To try a reviewed model locally, paste the generated JSON into the app
developer console as `model`, then run:

```js
sessionStorage.setItem('sketch-constraint-ranker-poc-v2', JSON.stringify(model))
```

The next check will use its probabilities to order solver-safe suggestions.
It does not hide candidates by probability. Clear the key to return to the
bundled model in this draft preview or the rules order in other builds. Invalid
model schemas produce an error and fall back to the preview model when present.
No reviewed examples are loaded by the app by default.

The text-to-cad POC checkout has a pinned inventory of 183 modeling-app KCL
test fixtures that can be used as source material. The inventory has no CAD
review labels. Other sources can be added with stable source references;
revalidate older KCL syntax and keep designated eval cases out of training.
The inventory itself is not a labeled dataset.

## Experimental weak-label training

The local `data/sketch_constraint_weak_poc/` directory contains a trained
baseline and its input and evaluation report. These labels mean only that a
candidate matches a constraint deliberately removed from a source test
fixture. They are **not** CAD reviews, user acceptance data, or proof of
design intent. The synthetic variants share four seed geometries from three
source files. The capture uses the app's candidate generator and feature
extraction plus real native Rust solver previews.

To reproduce the experiment, build the native capture example, then use the
bundled seed manifest:

```sh
RUSTC="$(rustup which rustc)" rustup run stable cargo build --manifest-path rust/Cargo.toml -p kcl-lib --example sketch_constraint_capture
SKETCH_WEAK_TRAIN_MANIFEST=data/sketch_constraint_seed_cases/manifest.jsonl \
SKETCH_WEAK_TRAIN_OUTPUT=data/sketch_constraint_weak_poc/samples.jsonl \
node_modules/.bin/vitest run --mode=development --project=unit src/machines/sketchSolve/constraints/constraintSuggestionWeakTrain.test.ts
node scripts/sketch-constraint-weak-fit.mjs data/sketch_constraint_weak_poc/samples.jsonl data/sketch_constraint_weak_poc/model.json data/sketch_constraint_weak_poc/report.json
```

The capture produced 40 sketch selections, 60 solver-safe candidates, and
20 non-target candidates. On leave-one-source-file-out checks, the rules
baseline recovered the omitted target first in 39/40 selections (19/20
ambiguous selections); the learned ranker did so in 20/40 (0/20 ambiguous).
The in-sample learned result was 40/40, showing how easily this small model
memorizes fixture types. The report sets `enable_in_app` to `false`.

## Experimental trained ranker in the preview

The new `data/sketch_constraint_corpus/` manifest pins 18 internal KCL test
files and groups related sketches into source families. The capture removes
one existing constraint expression at a time, runs the resulting program, and
records the app's candidates and native Rust solver previews. It captured 36
selections; the original synthetic capture contributes 40 more. Only 56 of
the combined 76 selections had a solver-safe candidate matching the removed
constraint. The other 20 are recorded as candidate-generation misses and are
excluded from ranker training.

The model is a regularized pairwise linear ranker with the geometry score as
its prior. Training weighs each sketch family equally, and evaluation holds
out entire families. On those weak-label holdouts, the model ranked the hidden
constraint first in 56/56 usable selections, compared with 55/56 for the
rules order. Of 34 selections with more than one candidate, the model got
34/34 and the rules order got 33/34. These are fixture-recovery scores, not
user acceptance or design-intent scores. The training labels include no CAD
reviews and some non-target candidates may also be valid design choices.

To reproduce the capture and training after building the native example:

```sh
SKETCH_CORPUS_MANIFEST=data/sketch_constraint_corpus/manifest.jsonl \
SKETCH_CORPUS_OUTPUT=data/sketch_constraint_corpus/samples.jsonl \
node_modules/.bin/vitest run --mode=development --project=unit src/machines/sketchSolve/constraints/constraintSuggestionCorpusCapture.test.ts
node scripts/sketch-constraint-pairwise-train.mjs data/sketch_constraint_weak_poc/samples.jsonl data/sketch_constraint_corpus/samples.jsonl src/machines/sketchSolve/constraints/sketchConstraintRankerModel.json data/sketch_constraint_corpus/report.json
```

The next data step is to collect CAD-reviewed accept/reject labels and
dimension-edit outcomes across independent project families, including
selections whose correct action is no suggestion. The reviewed evaluator
above is reserved for those records.

## Local measurements

The app keeps aggregate counts in session storage under
`sketch-constraint-suggestions-poc-v1`. In the app developer console, run:

```js
JSON.parse(sessionStorage.getItem('sketch-constraint-suggestions-poc-v1'))
```

`requested` counts automatic and manual checks, with `autoRequested` and
`manualRequested` splitting them. `modelRanked` counts checks ordered by the
bundled preview model or a locally loaded ranker. `candidate` counts generated
candidates. `solverRejected` counts failed solver previews, and
`geometryRejected` counts solved candidates hidden by the conflict or
movement check. `previewPassed` counts solver-approved candidates;
`shown` counts those actually displayed after the stale-result check.
`accepted` counts user clicks, `applied` counts successful mutations, and
`applyFailed` counts failed mutations. `totalPreviewMs / previewRuns`
gives mean preview latency. Counts are also grouped by constraint type.
No sketch geometry, project name, or user identifier is stored. Storage is
local to the current app session.

Use `accepted / shown` as the simple acceptance rate, with the caveat that
multiple suggestions may be shown per request. A high acceptance rate alone
does not prove design intent. This POC does not yet detect immediate undo.

## Evaluation needed for a learned ranker

Build a CAD-reviewed benchmark of about 100 varied sketches. Include sketches
whose correct outcome is no suggestion and
near misses where a constraint would encode the wrong intent. Record the
selected entity IDs, candidate type, features, reviewer accept/reject label,
reason, solver result, point movement, and outcome after changing a driving
dimension. Hold out entire projects or part families when training.
Do not use an ignored suggestion as a negative label without review.

The trained ranker uses constraint type, normalized geometric residual,
maximum preview movement, and selected-point freedom. Compare it with the
rules baseline using
precision at one suggestion, unsafe suggestion rate, acceptance, and
dimension-edit success on held-out families. Keep the solver and movement
gate after ranking; the ranker does not replace either check.

The Rust regression test `test_suggested_axis_survives_dimension_edit`
adds a horizontal relationship and a dimension, changes that dimension,
and checks that the line remains horizontal with the new length. The tangent
and symmetry regressions change a diameter and a distance respectively, then
check the resulting relationships. Human review across varied part families
is still needed. Passing solver checks or these regressions is not a
design-intent score.

The public documentation checkout was reviewed for affected sketch pages.
This feature remains behind an internal experimental flag, so no public
workflow documentation changes are needed yet.
