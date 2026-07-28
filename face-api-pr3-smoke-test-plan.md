# Face API PR3 smoke test plan

This plan exercises the user-facing risks in the SelectionV2/entity-reference
point-and-click overhaul. Run it against this branch first. If a result looks
wrong, repeat the closest equivalent on deployed `main` and record whether the
behavior is new to this PR.

For every test, wait for execution to finish before selecting geometry. Unless
the test says otherwise, the code should execute without
`experimentalFeatures = allow`.

## 1. Edge and face selection lifecycle

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(
  region001,
  length = 12,
  tagStart = $startCap,
  tagEnd = $endCap,
)
hide(sketch001)
```

### Workflow

1. Click one solid edge. Confirm only that edge remains highlighted and the
   selection status says `1 edge`.
2. Shift-click a second edge. Confirm both edges are highlighted and the count
   becomes `2 edges`.
3. Shift-click the first edge again. Confirm it is deselected while the second
   remains selected.
4. Click a face without Shift. Confirm the edge highlight clears, only the face
   remains highlighted, and the status says `1 face`.
5. Shift-click that face. Confirm it is deselected.
6. Select an edge, then click empty space. Confirm all selection state and
   engine highlighting clears.
7. Select an edge close to a face and confirm the adjacent face does not remain
   highlighted.

### Expected result

The viewport highlight, selection count, and actual selected entity always
agree. No selection flashes and then disappears.

### Notes




## 2. Selection-to-code and feature-tree synchronization

Use the KCL from test 1.

### Workflow

1. Open the code pane and click each of the four side faces in turn.
2. Confirm the editor highlights the corresponding sketch segment or generated
   face source rather than an unrelated operation.
3. Click a vertical edge, a cap edge, and each cap face. Confirm navigation is
   stable and does not throw an error.
4. Select `body001` in the Bodies pane and Feature Tree. Confirm the whole body
   is selected, not one arbitrary face.
5. Select `body001` in the Feature Tree, then click a face in the viewport.
   Confirm the body selection is replaced cleanly.

### Expected result

Viewport, editor, Bodies pane, and Feature Tree selections resolve to the same
operation without stale or duplicate highlights.

### Notes


## 3. Fillet creation from one and multiple edge selections

Use the KCL from test 1.

### Workflow

1. Select one top perimeter edge and start **Fillet**.
2. Enter a radius of `2`, submit, and inspect the generated KCL.
3. Undo the operation.
4. Shift-select two non-adjacent perimeter edges, start **Fillet**, enter a
   radius of `2`, and submit.
5. Before submitting a third attempt, select one edge and Shift-select a face.

### Expected result

- Valid selections generate `fillet(..., edges = [{ sideFaces = [...] }])`.
- The selected geometry is exactly the geometry filleted.
- Multiple edges produce multiple selectors or an equivalent unambiguous
  payload.
- The mixed edge-and-face selection is rejected clearly and does not create
  KCL.
- No deprecated `tags`, `edgeId`, or edge helper is generated for mapped edges.

### Notes


## 4. Chamfer creation, edit, and deletion

Use the KCL from test 1.

### Workflow

1. Select a cap perimeter edge and create a **Chamfer** of length `2`.
2. Inspect the generated `edges` payload and geometry.
3. Double-click the Chamfer in the Feature Tree, change the length to `3`, and
   submit.
4. Delete the Chamfer from its Feature Tree context menu.

### Expected result

The selected edge is chamfered, editing preserves the edge selector, and
deleting removes only the chamfer operation while restoring the original body.

### Notes


## 5. Ambiguous side faces require disambiguation

### KCL

```kcl
@settings(defaultLengthUnit = mm)

baseSketch = sketch(on = XY) {
  yoyo = line(start = [2, 0], end = [7, 6])
  middle = line(start = [7, 6], end = [7, 12])
  hi = line(start = [7, 12], end = [2, 0])
}
baseRegion = region(point = [5.5, 6], sketch = baseSketch)
baseSolid = extrude(
  baseRegion,
  length = 5,
  tagStart = $startCap,
  tagEnd = $endCap,
)

cutSketch = sketch(on = YZ) {
  cut1 = line(start = [-3.29, 4.75], end = [2.03, 2.44])
  cut2 = line(start = [2.03, 2.44], end = [-3.49, 0.31])
  cut3 = line(start = [-3.49, 0.31], end = [-3.29, 4.75])
}
cutRegion = region(point = [-1.58, 2.5], sketch = cutSketch)
cutSolid = extrude(cutRegion, length = 5)
result = subtract(baseSolid, tools = cutSolid)

hide(baseSketch)
hide(cutSketch)
```

### Workflow

1. Select one of the two edges shared by the `hi` and `yoyo` side faces.
2. Create a small Fillet.
3. Inspect the generated selector.
4. Undo, select the other edge sharing those side faces, and repeat.

### Expected result

Only the clicked edge is modified. The generated selector includes sufficient
`endFaces` or `index` information to distinguish the two edges.

### Negative path

Manually remove the disambiguating field from the generated selector. Execution
should fail clearly because multiple edges match; it must not crash the app or
silently modify both edges.

### Notes


## 6. Revolve around a generated solid edge

### KCL

```kcl
@settings(defaultLengthUnit = mm)

axisSketch = sketch(on = XZ) {
  a1 = line(start = [-20, -15], end = [20, -15])
  a2 = line(start = [20, -15], end = [20, 15])
  a3 = line(start = [20, 15], end = [-20, 15])
  a4 = line(start = [-20, 15], end = [-20, -15])
}
axisRegion = region(point = [0, 0], sketch = axisSketch)
axisBody = extrude(axisRegion, length = 8, tagEnd = $axisEnd)

profileSketch = sketch(on = YZ) {
  p1 = line(start = [30, 2], end = [36, 2])
  p2 = line(start = [36, 2], end = [36, 8])
  p3 = line(start = [36, 8], end = [30, 8])
  p4 = line(start = [30, 8], end = [30, 2])
}
profileRegion = region(point = [33, 5], sketch = profileSketch)

hide(axisSketch)
hide(profileSketch)
```

### Workflow

1. Select `profileRegion` from the code or Feature Tree and start **Revolve**.
2. Choose **Edge** for the axis.
3. Select a visible edge of `axisBody`, set an angle of `180deg`, and submit.
4. Inspect the generated axis payload and geometry.
5. Edit the Revolve from the Feature Tree and change the angle to `270deg`.

### Expected result

The generated axis uses a face API edge payload, the correct edge is used, and
editing the angle preserves that axis.

### Notes


## 7. Helix around a generated edge

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XZ) {
  line1 = line(start = [0, 0], end = [0, 100])
  line2 = line(start = [0, 100], end = [100, 0])
  line3 = line(start = [100, 0], end = [0, 0])
}
region001 = region(point = [20, 30], sketch = sketch001)
body001 = extrude(region001, length = 30, tagEnd = $capEnd)
hide(sketch001)
```

### Workflow

1. Start **Helix**, choose **Edge**, and select a visible edge of `body001`.
2. Use radius `3`, revolutions `4`, and angle start `0`.
3. Submit and inspect the generated `axis`.
4. Edit the Helix from the Feature Tree, change radius to `5`, and toggle its
   direction.
5. Delete the Helix from the Feature Tree.

### Expected result

Creation emits a face API edge payload, editing preserves the selected edge,
and deletion removes only the Helix.

### Notes


## 8. Mirror across edge, sketch segment, plane, and axis

### KCL

```kcl
@settings(defaultLengthUnit = mm)

baseSketch = sketch(on = XY) {
  line1 = line(start = [0, 0], end = [10, 0])
  line2 = line(start = [10, 0], end = [10, 10])
  line3 = line(start = [10, 10], end = [0, 10])
  line4 = line(start = [0, 10], end = [0, 0])
  constructionAxis = line(
    start = [-5, -5],
    end = [15, 15],
    construction = true,
  )
}
baseRegion = region(point = [5, 5], sketch = baseSketch)
baseSolid = extrude(baseRegion, length = 5, tagEnd = $capEnd)
mirrorPlane = offsetPlane(YZ, offset = 20)
```

### Workflow

Run each case separately, undoing between cases:

1. Create Mirror using a generated edge of `baseSolid` as **Across**.
2. Create Mirror using `baseSketch.constructionAxis`.
3. Create Mirror using `mirrorPlane`.
4. Create Mirror using the built-in `X`, `Y`, or `Z` axis.
5. Edit and delete each successful Mirror from the Feature Tree.

### Expected result

The generated solid edge uses a face API payload. The direct sketch segment,
plane, and axis remain their native reference forms. All four modes create the
expected mirrored body and remain editable/deletable.

### Notes


## 9. Surface edge selection

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  line1 = line(start = [0, 0], end = [20, 0])
  line2 = line(start = [20, 0], end = [20, 12])
}
surface001 = extrude(
  sketch001.line1,
  length = 10,
  bodyType = SURFACE,
  method = NEW,
)
hide(sketch001)
```

### Workflow

1. Select each boundary edge of `surface001`.
2. Confirm it highlights as an edge and navigates to `surface001` in code.
3. Use a surface edge as the axis for Revolve or Helix.
4. Select the surface face and confirm it is not coerced to an edge.

### Expected result

Surface edges participate in edge-only command inputs using an entity-reference
payload. The surface face remains a face selection and is rejected from
edge-only inputs.

### Notes


## 10. Shell mapped and unmapped faces

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(
  region001,
  length = 12,
  tagStart = $startCap,
  tagEnd = $endCap,
)
hide(sketch001)
```

### Workflow

1. Select `endCap` and create a Shell of thickness `2`.
2. Confirm generated KCL uses the stable cap tag.
3. Undo and shell one side wall.
4. Inspect whether the wall uses its stable tag or a documented `faceId`
   fallback.
5. Edit thickness from the Feature Tree, then delete the Shell.

### Expected result

Mapped faces prefer tags. A genuinely unmapped primitive may use `faceId`, but
must select the intended face, execute successfully, and remain editable.

### Negative path

Select an edge before opening Shell. The command should reject it as the wrong
selection type rather than silently choosing an adjacent face.

### Notes


## 11. Sketch on generated, chamfered, and opposite faces

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(region001, length = 12, tagEnd = $endCap)
chamfer001 = chamfer(
  body001,
  edges = [{ sideFaces = [region001.tags.bottom, endCap] }],
  length = 2,
)
hide(sketch001)
```

### Workflow

1. Select an unchanged side wall and enter sketch mode.
2. Exit without drawing and confirm no KCL is deleted.
3. Select the chamfer face and create a small closed sketch on it.
4. Exit and extrude that region.
5. Repeat sketch entry from the opposite cap while approaching it from a
   different camera angle.

### Expected result

The selected face is the sketch plane, sketch orientation matches current
mainline behavior, and downstream face topology does not prevent sketch entry,
exit, or extrusion.

### Notes


## 12. Delete Face with stable tag and primitive fallback

### KCL

```kcl
@settings(defaultLengthUnit = mm, experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 16])
  top = line(start = [24, 16], end = [0, 16])
  left = line(start = [0, 16], end = [0, 0])
}
region001 = region(point = [12, 8], sketch = sketch001)
body001 = extrude(region001, length = 10, tagEnd = $endCap)
chamfer001 = chamfer(
  body001,
  edges = [
    { sideFaces = [region001.tags.bottom, endCap] },
    { sideFaces = [region001.tags.right, endCap] }
  ],
  length = 2,
)
hide(sketch001)
```

### Workflow

1. Delete the cap face of a fresh `body001` version and confirm a stable tag is
   used.
2. Restore the full snippet and delete one of the two chamfer faces.
3. Confirm the command reaches review without “Couldn't retrieve face from
   selection”.
4. Submit and inspect the generated KCL.
5. Delete the new Delete Face operation from the Feature Tree.

### Expected result

The cap uses a stable tag. The multi-selector chamfer face may use
`faceId(chamfer001, index = ...)` as a fallback, but it must delete the selected
face and remain reversible from the Feature Tree.

### Notes


## 13. Delete Face through chained edge cuts

### KCL

```kcl
@settings(defaultLengthUnit = mm, experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(region001, length = 12, tagEnd = $endCap)
chamfer001 = chamfer(
  body001,
  edges = [{ sideFaces = [region001.tags.bottom, endCap] }],
  length = 2,
)
fillet001 = fillet(
  chamfer001,
  edges = [{ sideFaces = [region001.tags.top, endCap] }],
  radius = 2,
)
hide(sketch001)
```

### Workflow

1. Delete the chamfer face and inspect the generated reference.
2. Undo, delete the fillet face, and inspect the generated reference.
3. Undo, then delete the fillet face followed by the chamfer face.
4. Comment and uncomment the generated Delete Face lines one at a time.

### Expected result

Selections never fail with “Couldn't retrieve face from selection”. Stable
edge-cut tags are preferred where available; primitive fallback is acceptable
for unmapped chained faces. Re-execution must not arbitrarily change a valid
primitive index.

### Notes


## 14. Automatic Z0006 migration before point-and-click edit

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [20, 0])
  right = line(start = [20, 0], end = [20, 12])
  top = line(start = [20, 12], end = [0, 12])
  left = line(start = [0, 12], end = [0, 0])
}
region001 = region(point = [10, 6], sketch = sketch001)
body001 = extrude(region001, length = 10, tagEnd = $endCap)
rounded = fillet(
  body001,
  radius = 1,
  tags = [getCommonEdge(faces = [region001.tags.bottom, endCap])],
)
```

### Workflow

1. Confirm Z0006 appears and offers an automatic refactor.
2. Apply it manually and confirm the result uses `edges`.
3. Undo back to legacy KCL.
4. Open the Fillet for editing from the Feature Tree.
5. Confirm migration occurs before editing, change radius to `2`, and submit.

### Expected result

Manual and pre-edit migration select the same edge, preserve geometry, and do
not leave the deprecated helper behind.

### Negative path

Replace the fillet target with a direct sketch segment in an edge-extrude
operation. A valid sketch segment must not be rewritten merely because another
argument triggers Z0006.

### Notes


## 15. Invalid and mixed selections in the command bar

Use the KCL from test 1.

### Workflow

1. Open Fillet with no selection and try to continue.
2. Select one face and try to continue.
3. Select one edge, then Shift-select one face.
4. Press Escape and verify command-local selections clear.
5. Cancel the command and verify no KCL was added.
6. Open Shell, select an edge, and try to continue.
7. Open Revolve with no profile selected, then select a face instead of a
   region.

### Expected result

Each invalid state is blocked with relevant validation copy. Valid selections
do not survive incorrectly after Escape/cancel, and no adjacent entity is
silently substituted.

### Notes


## 16. Feature-tree deletion in a pipe expression

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(
  region001,
  length = 12,
  tagStart = $startCap,
  tagEnd = $endCap,
)
  |> fillet(
       edges = [{ sideFaces = [region001.tags.top, endCap] }],
       radius = 2,
     )
  |> chamfer(
       edges = [{ sideFaces = [region001.tags.bottom, endCap] }],
       length = 2,
     )

hide(sketch001)
```

### Workflow

Reload the original snippet before each case:

1. Delete the Chamfer from the Feature Tree.
2. Delete the Fillet from the Feature Tree.
3. Delete the Extrude from the Feature Tree.

### Expected result

Deleting Chamfer removes only the final pipe stage. Deleting Fillet removes the
Fillet and dependent Chamfer tail but retains the Extrude. Deleting Extrude
removes the whole dependent modeling expression but leaves the sketch and
region intact. The app must not crash when the code pane is opened afterward.

### Notes


## 17. Re-execution and stale selection cleanup

Use the KCL from test 1.

### Workflow

1. Select an edge and note its highlight and code location.
2. Change `length = 12` to `length = 18`.
3. Confirm execution completes without a stale highlight on a different edge.
4. Re-select the corresponding edge.
5. Add `translate(body001, x = 5)` as a separate expression or pipe stage.
6. Rapidly change the translation between `5`, `10`, and `15`.
7. Delete the selected operation, then click empty space and select another
   face.

### Expected result

Selection state does not retain obsolete engine IDs across execution. No ghost
highlight, duplicate selection, wrong code navigation, or console exception
appears.

### Notes


## 18. Legacy sketch selection and constraints regression

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  line1 = line(start = [0, 0], end = [20, 4])
  line2 = line(start = [20, 4], end = [25, 18])
  line3 = line(start = [25, 18], end = [4, 20])
  line4 = line(start = [4, 20], end = [0, 0])
}
```

### Workflow

1. Enter sketch edit mode.
2. Select and Shift-select individual segments; confirm toggling works.
3. Select two segments and apply Equal Length.
4. Undo, select one segment, and apply Horizontal/Vertical as appropriate.
5. Select two connected segments and apply an angle constraint.
6. Box-select multiple segments, click empty space, then reselect one segment.
7. Exit sketch mode and confirm the sketch remains present and executable.

### Expected result

The new modeling selection payload does not break sketch-mode segment
selection, deselection, constraint toolbar guards, or sketch exit behavior.

### Notes


## Completion summary

After running all tests, record:

- Tests passed:
- Tests failed only on this branch:
- Tests also failed on deployed `main`:
- Cases that generated `faceId(...)`:
- Cases that generated deprecated edge syntax:
- Console errors worth investigating:
- Follow-up tests or issues:

