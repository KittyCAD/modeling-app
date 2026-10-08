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

This works as intended now


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

for step 4, selecting the body puts the cursor in the right place, and the body001 in the feature tree lights up, but the whole body does not highlight in the viewport, selecting region001 in the feature tree does make the whole body highlight and this is all consitent with main so I think we're okay.


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
Works as expected

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

works


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
should modify every edge matching the remaining selector. It must not crash the
app or choose one matching edge arbitrarily.

### Notes
works
The negative path fillets both matching edges, which is expected.


## 6. Revolve around a generated solid edge

### KCL

```kcl
@settings(defaultLengthUnit = mm)

axisSketch = sketch(on = XY) {
  a1 = line(start = [0, 0], end = [8, 0])
  a2 = line(start = [8, 0], end = [8, 8])
  a3 = line(start = [8, 8], end = [0, 8])
  a4 = line(start = [0, 8], end = [0, 0])
}
axisRegion = region(point = [4, 4], sketch = axisSketch)
axisBody = extrude(axisRegion, length = 20, tagEnd = $axisEnd)

profileSketch = sketch(on = YZ) {
  p1 = line(start = [15, 4], end = [20, 4])
  p2 = line(start = [20, 4], end = [20, 9])
  p3 = line(start = [20, 9], end = [15, 9])
  p4 = line(start = [15, 9], end = [15, 4])
}
profileRegion = region(point = [17, 6], sketch = profileSketch)

hide(axisSketch)
hide(profileSketch)
```

### Workflow

1. Select `profileRegion` from the code or Feature Tree and start **Revolve**.
2. Choose **Edge** for the axis.
3. Select the vertical edge of `axisBody` at `x = 0, y = 0`, set an angle of
   `180deg`, and submit. This edge lies in the `YZ` profile plane.
4. Inspect the generated axis payload and geometry.
5. Edit the Revolve from the Feature Tree and change the angle to `270deg`.

### Expected result

The generated axis uses a face API edge payload, the correct edge is used, and
editing the angle preserves that axis.

### Notes

This works now


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

Adding the helix has the following code
```
helix001 = helix(
  axis = {
    sideFaces = [capStart001, region001.tags.line3],
    endFaces = [
      region001.tags.line2,
      region001.tags.line1
    ]
  },
  revolutions = 4,
  angleStart = 0,
  radius = 3,
)

```
Here `endFaces` is redundant because only one edge matches the two `sideFaces`.

When I edit through the feature tree and change the radius to 5, the resulting code is
```
helix001 = helix(
  axis = {
    sideFaces = [capStart001, region001.tags.line3]
  },
  revolutions = 4,
  angleStart = 0,
  radius = 5,
)

```
The radius changed as expected and the redundant `endFaces` were removed.
Point-and-click creation serializes the full entity reference returned for the
clicked edge. Feature-tree editing reconstructs the selection and serializes
the minimal selector needed to identify it. This is existing, intentional
normalization and is already covered by the Revolve point-and-click edit test.
No rerun is required.

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

Fixed locally: Mirror now recognizes an entity-reference edge even when it has
no legacy edge artifact. Rerun only the vertical and top generated-edge cases.
The sketch segment, plane, and built-in axis cases do not need repeating.

Works now


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

PR3 regression to investigate: boundary-edge clicks produce no viewport,
selection-status, editor, or Feature Tree response. Rerun all of this test after
the surface-edge selection mapping is fixed.

Okay the selections seem to work, shift click toggles etc, however step 3, in the cmdBar I get the error `Failed to create tag for face 34db5201-0f75-508f-804e-106ad360604d: Selection is not a sketch segment` and it won't let me progress. So there's still more to progress.


Edit, this is working now

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

This all works as expected


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

PR3 regression to investigate:

- A side wall reports `Incompatible face, please try another`.
- `endCap` enters the old sketch mode.
- The chamfer face is unresponsive and shows no error.

Rerun the complete test after sketch-on-face selection is fixed.

Updated notes after a fix attempt was implemented
- Sketching on a side wall, or an endcap works just fine, produces code like
```
face001 = faceOf(body001, face = region001.tags.bottom)
sketch002 = sketch(on = face001) {
  //...
}
```
- sketching on a end cap, though doesn't use teh best tags, produces code like
```
face002 = faceOf(body001, face = END)
sketch003 = sketch(on = face002) {
  //...
}
```

When it would be better if it taged the extrusion and used that i.e.
```
body001 = extrude(region001, length = 12, tagEnd = $endCap)
face002 = faceOf(body001, face = endCap)
sketch003 = sketch(on = face002) {
  //...
}
```

- sketching on the chamfer face does not work at all, selecting it after clicking start sketch has a toast error `Extrusion is not a valid artifact: Error: edgeCut has no edge_ids or consumedEdgeId`. I don't understand this error I don't understand what having edge_ids or consummedEdgeIds has to do with using the chamfer's face to add a tag to the chamfer and sketching on it.

If you want to add an e2e test for this, you can pause before the selection and I can give you the click coord.

For what it's worth this is the kcl I would expect
```
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
  edges = [
    {
      sideFaces = [endCap, region001.tags.bottom],
      endFaces = [
        region001.tags.top,
        region001.tags.right
      ]
    }
  ],
  length = 3,
  tag = $yoyo,
)
face001 = faceOf(body001, face = yoyo)
sketch002 = sketch(on = face001) {
  circle1 = circle(start = [var 13.37mm, var 5.05mm], center = [var 12.13mm, var 6.23mm])
}

```

This works as is, but not just starting an sketch, if I try and edit sketch002 from above I get `Could not determine plane/face information`

But if we're doing chamfer we probably cover this usecase

```
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
  edges = [
    {
      sideFaces = [endCap, region001.tags.bottom],
      endFaces = [
        region001.tags.top,
        region001.tags.right
      ]
    },
    {
      sideFaces = [endCap, region001.tags.top],
      endFaces = [
        region001.tags.bottom,
        region001.tags.left
      ]
    }
  ],
  length = 3,
)

```

In this case when a user selects a chamfer we can't add a tag because the one chamfer Call has two chamfers, so we can either give the user a toast sayng why sketch on this face isn't supported. Or our codemode splits the chamfer up, which I think we might have a precedent for this so maybe not too hard?


Edit, this is working now



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

Removiing the deletedFace of the chamfer from the feature tree produces this code
```
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
    {
      sideFaces = [region001.tags.bottom, endCap]
    },
    {
      sideFaces = [region001.tags.right, endCap]
    }
  ],
  length = 2,
)
hide(sketch001)
face001 = faceId(chamfer001, index = 7)

```

The leftover `faceId` errors with `No such face exists at the requested index`.
This reproduces on deployed main with equivalent legacy edge syntax, so it is
not a PR3 regression. No rerun is required for this PR.


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

This mostly worked. Commenting and uncommenting can make `faceId` fail with `No
such face exists at the requested index`. This also occurs on deployed main, so
it is not a PR3 regression. No rerun is required for this PR.

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

works

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

this all worked, the only thing that was different is that escape both cleared the selection and closed the cmd bar at the same time, but this doesn't seem like a problem to me.


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

works

## 17. Re-execution and stale selection cleanup

Use the KCL from test 1.

### Workflow

1. Select the top front perimeter edge and confirm the status says `1 edge`.
2. Change `length = 12` to `length = 18` and wait for execution.
3. Confirm no unrelated edge remains highlighted and the app reports no stale
   selection error.
4. Click empty space, then select the corresponding top front edge again.
5. Replace `body001 = extrude(...)` with
   `body001 = extrude(...) |> translate(x = 5)`.
6. Change `x` from `5` to `10`, then `15`, waiting for execution each time.
7. Click empty space and select a side face. Confirm the face highlights and
   code navigation still points to `body001`.

### Expected result

Selection state does not retain obsolete engine IDs across execution. No ghost
highlight, duplicate selection, wrong code navigation, or console exception
appears.

### Notes

Rerun the clarified workflow.


## 18. Legacy sketch selection and constraints regression

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0, var 0], end = [var 20, var 4])
  line2 = line(start = [var 20, var 4], end = [var 25, var 18])
  line3 = line(start = [var 25, var 18], end = [var 4, var 20])
  line4 = line(start = [var 4, var 20], end = [var 0, var 0])
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

Yes this worked


## Completion summary

After running all tests, record:

- Tests passed:
- Tests failed only on this branch:
- Tests also failed on deployed `main`:
- Cases that generated `faceId(...)`:
- Cases that generated deprecated edge syntax:
- Console errors worth investigating:
- Follow-up tests or issues:


# Test session 2

This session tests edge selection after operations that copy, transform, split,
merge, or replace topology. Fillet is the primary consumer because it provides
a clear visual indication that the selected edge was resolved correctly.
Fillet and Chamfer use the same edge-cut command path, so they do not need to be
repeated for every topology producer.

Revolve, Helix, Mirror 3D across an edge, and surface edge extrusion use
different engine command payloads. Tests 2.11 and 2.12 exercise those
consumers separately after representative lineage-changing operations.

For every point-and-click operation:

1. Confirm the viewport highlight and selection status identify only the
   clicked edge.
2. Inspect the generated KCL. Prefer a `sideFaces` payload and confirm it does
   not contain raw UUIDs.
3. Confirm the resulting geometry uses the clicked edge, not a neighboring
   edge.
4. Change a numeric argument in code, wait for re-execution, and confirm the
   selected geometry does not jump.
5. Undo or delete the new operation before continuing to the next case.

## 2.1. Edge selection after ordinary transforms

This is the control case. Translate, rotate, and scale should preserve the
solid's topology rather than create new topological lineage.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 16])
  top = line(start = [24, 16], end = [0, 16])
  left = line(start = [0, 16], end = [0, 0])
}
region001 = region(point = [12, 8], sketch = sketch001)
body001 = extrude(region001, length = 10, tagEnd = $endCap)
  |> translate(x = 8, y = 5, z = 3)
  |> rotate(yaw = 20deg, pitch = 10deg)
  |> scale(x = 1.2, y = 1.2, z = 1.2)

hide(sketch001)
```

### Workflow

1. Fillet one transformed cap edge with radius `2`.
2. Undo, then fillet one transformed vertical edge.
3. Change the final scale from `1.2` to `1.3`, then back to `1.2`.
4. Repeat one edge selection after re-execution.

### Expected result

The transformed edge stays associated with the original face tags. No stale
highlight or neighboring-edge substitution appears after re-execution.

### Notes


## 2.2. Edge selection on a clone

Clone creates a new body and must remap the source body's tagged topology onto
the clone rather than resolving selections against the original.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [20, 0])
  right = line(start = [20, 0], end = [20, 14])
  top = line(start = [20, 14], end = [0, 14])
  left = line(start = [0, 14], end = [0, 0])
}
region001 = region(point = [10, 7], sketch = sketch001)
body001 = extrude(region001, length = 10, tagEnd = $endCap)
body002 = clone(body001)
  |> translate(x = 32)

hide(sketch001)
```

### Workflow

1. Select a top perimeter edge on `body002` and create a Fillet of radius `2`.
2. Confirm only the clone changes.
3. Undo and select the geometrically corresponding edge on `body001`.
4. Shift-select corresponding edges on both bodies and attempt one Fillet.

### Expected result

Each edge resolves to the body that was clicked. The multi-body selection must
either create a valid operation for both bodies or reject the combination
clearly; it must not silently apply both selectors to one body.

### Notes

step 1, unable to get through the cmd bar, 
When I select the edge, it says one edge selected and lets me go through most of the flow, like I set the radius. But then on the, like, submit page, it has the following error and the submit button is disabled.
`undefined_value: 'seg01' is not defined`

It's debatable whether we should try and fix this because I tried it on main and, um, similar thing, in the sense it's related to the selection. It doesn't even let me make it past the first bit of the selection. And the error's different, it says no edge is found in this selection. But similar path in that I can't get through the command bar flow because of edge selection being broken in some way.
`No edges found in the selection`
I do think it's worth looking into though, because if it's something simple, it's probably going to affect a lot of the rest of the test. I'm speculating here without having gone through them, but I think it's probably worth at least seeing how difficult it might be to fix before we decide, yeah, this is a fix that needs to go into main and not directly related to our work here.

How would you like to fix, e2e test with me geving you a click coord from a pause()?


## 2.3. Edge selection on linear and circular pattern instances

Pattern instances are returned as multiple solids and have instance-specific
IDs. This is distinct from Clone even though both copy geometry.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [12, 0])
  right = line(start = [12, 0], end = [12, 8])
  top = line(start = [12, 8], end = [0, 8])
  left = line(start = [0, 8], end = [0, 0])
}
region001 = region(point = [6, 4], sketch = sketch001)
body001 = extrude(region001, length = 8, tagEnd = $endCap)
linearBodies = patternLinear3d(
  body001,
  instances = 3,
  distance = 22,
  axis = X,
)

circleSketch = sketch(on = XY) {
  circle1 = circle(center = [0, 5], start = [2, 0])
}
circleRegion = region(point = [0, 4], sketch = circleSketch)
cylinder001 = extrude(circleRegion, length = 8)
circularBodies = patternCircular3d(
  cylinder001,
  instances = 4,
  axis = Z,
  center = [0, 0, 0],
)

hide(sketch001)
hide(circleSketch)
```

### Workflow

1. Fillet one edge on the second linear-pattern instance.
2. Undo and fillet the corresponding edge on the third instance.
3. Fillet a cap edge on one circular-pattern instance.
4. Change `instances = 3` to `4` for the linear pattern and verify a newly
   created instance can also be selected.
5. Select an edge on one instance and Shift-select an edge on another.

### Expected result

The clicked instance alone is modified. Re-execution does not move the
selection to the original or a different instance. A cross-instance selection
is handled explicitly rather than being collapsed onto one solid.

### Notes

Similar story for pattern, only tried it for the linear pattern but I get
`No edges found in the selection (codemode: groupSelectionByBodyAndAddTages -- no body keys; graph grouping + primitive-edge topology path produced nothing)`

And on main it says "Please select one or more edges" in the cmdbar but goes read and won't let me progress past the selection step.


## 2.4. Edge selection on a mirrored result

Mirror creates a separate result with mirrored topology and orientation.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  bottom = line(start = [8, 0], end = [24, 0])
  right = line(start = [24, 0], end = [24, 12])
  top = line(start = [24, 12], end = [8, 12])
  left = line(start = [8, 12], end = [8, 0])
}
region001 = region(point = [16, 6], sketch = sketch001)
body001 = extrude(region001, length = 10, tagEnd = $endCap)
body002 = mirror3d(body001, across = YZ)

hide(sketch001)
```

### Workflow

1. Fillet a top perimeter edge on `body002`.
2. Confirm `body001` remains unchanged.
3. Undo and Chamfer a vertical edge on `body002`.
4. Change the Chamfer length in code and confirm it remains on that edge.
5. Shift-select corresponding edges from the original and mirror.

### Expected result

Mirrored orientation does not swap adjacent faces or redirect the operation to
the source body. The mixed-body case is either supported correctly or rejected
clearly.

### Notes

adding the chamfer on body002 works fine, and so does undo or deleting it, problems though are:

1) it creates a `edgeId` call which is probbaly just the fall back on main
2) You cannot edit the chamfer after it's added, Double-clicking it in the feature tree opens up the model, you can change the fillet length or chamfer length from two to three, say, but then when you go to submit it, it gives you like some sort of like selection error. It's slightly different between main and our branch, but it is already on main, so probably another existing problem, don't need to worry about it.
3) I'm seeing this too if I try and fillet the original body https://github.com/KittyCAD/modeling-app/issues/12420 so again on main

## 2.5. Edge selection after subtraction

Subtraction creates preserved target edges, tool-created concave edges, and
potentially split edges. Those categories should be checked separately.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

baseSketch = sketch(on = XY) {
  b1 = line(start = [0, 0], end = [30, 0])
  b2 = line(start = [30, 0], end = [30, 24])
  b3 = line(start = [30, 24], end = [0, 24])
  b4 = line(start = [0, 24], end = [0, 0])
}
baseRegion = region(point = [15, 12], sketch = baseSketch)
baseBody = extrude(baseRegion, length = 12, tagEnd = $baseEnd)

toolSketch = sketch(on = XY) {
  t1 = line(start = [8, 6], end = [22, 6])
  t2 = line(start = [22, 6], end = [22, 18])
  t3 = line(start = [22, 18], end = [8, 18])
  t4 = line(start = [8, 18], end = [8, 6])
}
toolRegion = region(point = [15, 12], sketch = toolSketch)
toolBody = extrude(toolRegion, length = 7)
result = subtract(baseBody, tools = toolBody)

hide(baseSketch)
hide(toolSketch)
```

### Workflow

Run each case from the original snippet:

1. Fillet an untouched outer vertical edge.
2. Fillet an outer cap edge that was split by the subtraction, if present.
3. Fillet one internal concave edge created by the tool.
4. Shift-select two internal edges sharing the same tool-created wall.
5. Change the tool extrusion length from `7` to `8`, then repeat case 3.

### Expected result

Each category resolves to the clicked edge. Generated selectors include
`endFaces` or `index` when the side faces alone match more than one edge.
Changing the tool length must not make a surviving fillet jump elsewhere.

### Notes

This worked well, there were some errors that seems like engine unable to fillet errors but really our concern atm.


## 2.6. Edge selection after union

Union merges bodies and can remove, retain, or split input faces.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  a1 = line(start = [0, 0], end = [22, 0])
  a2 = line(start = [22, 0], end = [22, 16])
  a3 = line(start = [22, 16], end = [0, 16])
  a4 = line(start = [0, 16], end = [0, 0])
}
region001 = region(point = [11, 8], sketch = sketch001)
body001 = extrude(region001, length = 10)

sketch002 = sketch(on = XY) {
  b1 = line(start = [14, 8], end = [32, 8])
  b2 = line(start = [32, 8], end = [32, 24])
  b3 = line(start = [32, 24], end = [14, 24])
  b4 = line(start = [14, 24], end = [14, 8])
}
region002 = region(point = [23, 16], sketch = sketch002)
body002 = extrude(region002, length = 14)
result = union([body001, body002])

hide(sketch001)
hide(sketch002)
```

### Workflow

1. Fillet an edge inherited only from `body001`.
2. Undo and fillet an edge inherited only from `body002`.
3. Undo and fillet an edge created where the two outer boundaries meet.
4. Change `body002` length from `14` to `15`, then back to `14`.

### Expected result

Edges inherited from either input and edges created by the union are selectable.
A primitive fallback is acceptable for an unmapped generated edge, but it must
modify the clicked edge and remain stable after re-execution.

### Notes

This mostly all worked, with the exception that a few of the fillets where the bodies joined, like the ones that were, the scene where the union kind of took place, often didn't work. They failed, but they failed on the engine, not the selection. Which, that's the main thing we're trying to verify. We're not trying to verify whether fillets work, right? And so I was able to, for the most part, substitute fillet with, like, adding just an annotation GDT annotation to those edges, and they got attached correctly to the edges. So it was simply that the CSG was failing, but the selection on the edge sort of always worked in this case. So I think we can check this off as far as we're concerned with the face API work.


## 2.7. Edge selection after intersection

Intersection discards most input topology, so surviving face provenance differs
from Union and Subtract.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

sketch001 = sketch(on = XY) {
  a1 = line(start = [0, 0], end = [24, 0])
  a2 = line(start = [24, 0], end = [24, 18])
  a3 = line(start = [24, 18], end = [0, 18])
  a4 = line(start = [0, 18], end = [0, 0])
}
region001 = region(point = [12, 9], sketch = sketch001)
body001 = extrude(region001, length = 14)

sketch002 = sketch(on = YZ) {
  b1 = line(start = [-4, 4], end = [18, 4])
  b2 = line(start = [18, 4], end = [18, 12])
  b3 = line(start = [18, 12], end = [-4, 12])
  b4 = line(start = [-4, 12], end = [-4, 4])
}
region002 = region(point = [7, 8], sketch = sketch002)
body002 = extrude(region002, length = 30, symmetric = true)
result = intersect([body001, body002])

hide(sketch001)
hide(sketch002)
```

### Workflow

1. Fillet one edge whose adjacent faces come from different input bodies.
2. Undo and fillet a second, non-parallel edge.
3. Shift-select two edges and create one Fillet.
4. Change `body001` length from `14` to `15`, then back to `14`.

### Expected result

The intersection result can be selected without resolving back to a consumed
input body. Re-execution preserves the chosen edge or reports a clear topology
change; it must not silently jump.

### Notes

This one all worked perfectly. It's really nice to have one that's just great, so no comments, worked well.


## 2.8. Chained lineage: subtraction, clone, then pattern

This deliberately combines three lineage layers. It is a higher-value stress
case than repeating every consumer against every individual operation.

### KCL

```kcl
@settings(defaultLengthUnit = mm)

baseSketch = sketch(on = XY) {
  b1 = line(start = [0, 0], end = [24, 0])
  b2 = line(start = [24, 0], end = [24, 18])
  b3 = line(start = [24, 18], end = [0, 18])
  b4 = line(start = [0, 18], end = [0, 0])
}
baseRegion = region(point = [12, 9], sketch = baseSketch)
baseBody = extrude(baseRegion, length = 10)

holeSketch = sketch(on = XY) {
  hole = circle(center = [12, 9], radius = 4)
}
holeRegion = region(point = [12, 9], sketch = holeSketch)
holeBody = extrude(holeRegion, length = 10)
cutBody = subtract(baseBody, tools = holeBody)
clonedBody = clone(cutBody)
  |> translate(x = 34)
patternedBodies = patternLinear3d(
  clonedBody,
  instances = 3,
  distance = 28,
  axis = Y,
)

hide(baseSketch)
hide(holeSketch)
```

### Workflow

1. Fillet an internal circular edge on the second pattern instance.
2. Undo and Fillet an outer edge on the third instance.
3. Change pattern distance from `28` to `30`, then back to `28`.
4. Repeat the internal-edge selection.

### Expected result

Selection resolves through CSG, Clone, and Pattern to the clicked instance.
Neither operation may be applied to `cutBody`, `clonedBody`, or the wrong
pattern instance.

### Notes

This mostly just didn't work, and I suspect it's for the reasons that other things have failed. So, when I tried to, so, because it clones it and then patterns a clone, right? So, I tried the second pattern like you said, and it basically wouldn't make it past selection, but we have other problems with, even though this was the second pattern and you had mentioned come up with fixes for pattern, we've since stashed those, but it could be the clone as well because the clone's first, and we have issues with those as well. Then I tried doing the first instance, so the one that was cloned to the first instance of the pattern, and it also similarly wouldn't let me progress through the command bar. Then I tried filling in the original, and it did work, like, as in the engine seemed to struggle, like, it didn't throw an error, but the fillet or chamfer, I can't remember which one, did look broken. But it did at least attempt it, which, but it used an edge ID, so it still used the fallback to do it. But yeah, I, for the most part, this didn't work, but I think it comes down to, you know, we have a lot of problems with both clone and linear pattern, so I'd come back to this once those are resolved, or make sure this works when trying to resolve those, I suppose.


## 2.9. Edge-treatment chains in both orders

Fillet and Chamfer share the edge-cut endpoint, but generated edge-cut faces
become new selection sources. Both operation orders are therefore worth one
test.

### KCL

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 20])
  top = line(start = [30, 20], end = [0, 20])
  left = line(start = [0, 20], end = [0, 0])
}
region001 = region(point = [15, 10], sketch = sketch001)
body001 = extrude(region001, length = 12, tagEnd = $endCap)

hide(sketch001)
```

### Workflow

Run each case from the original snippet:

1. Chamfer one cap edge, then Fillet an untouched edge on the result.
2. Chamfer one cap edge, then Fillet one boundary edge of the new Chamfer face.
3. Fillet one cap edge, then Chamfer an untouched edge on the result.
4. Fillet one cap edge, then Chamfer one boundary edge of the new Fillet face.
5. Change the first operation's size, then restore it.
6. Delete the first operation from the Feature Tree and confirm its dependent
   pipe tail is removed consistently.

### Expected result

The second operation uses the clicked post-treatment edge. Re-execution does
not move either treatment. If a generated edge cannot be represented stably,
the command must fail clearly rather than generate a selector for another edge.

### Notes

for 2 it produced 
```
edge001 = edgeId(body001, index = 8)
fillet001 = fillet(body001, tags = edge001, radius = 0.3)

```

This is frustrating when I can manually write the following and it works
```
chamfer001 = chamfer(
  body001,
  edges = [
    {
      sideFaces = [endCap, region001.tags.left],
      endFaces = [
        region001.tags.bottom,
        region001.tags.top
      ]
    }
  ],
  length = 3,
  tag = $yoyo,
)
fillet001 = fillet(
  body001,
  edges = [
    {
      sideFaces = [yoyo, region001.tags.bottom]
    }
  ],
  radius = 0.3,
)
```

I.e. it's using the fallback when really I think we should be able to tag the chamfer in order to use it with side faces


So 4 is the same as 2, it uses the edgeId(...) for the second edgeCut/chamfer,

But interestingly when trying to edit the fillet, the auto-refactor kicks in and refactors the chamfer even though that's not what we're editing, but then when submitting the cmdbar from the edit it fails
```
trap.ts:39 Error: No edge selections found
    at groupSelectionsByBodyAndCreateEdgeRefs (edges.ts:2907:12)
    at addFillet (edges.ts:161:28)
    at modelingMachine.ts:4779:27
    at Object.start (chunk-4HFCGIVX.js?v=b28049a9:2803:47)
    at Actor.start (chunk-4HFCGIVX.js?v=b28049a9:862:20)
    at chunk-4HFCGIVX.js?v=b28049a9:1149:14
    at Actor.update (chunk-4HFCGIVX.js?v=b28049a9:647:9)
    at Actor._process (chunk-4HFCGIVX.js?v=b28049a9:902:10)
    at Mailbox.flush (chunk-4HFCGIVX.js?v=b28049a9:107:12)
    at Mailbox.enqueue (chunk-4HFCGIVX.js?v=b28049a9:101:12)
err @ trap.ts:39
addFillet @ edges.ts:172
(anonymous) @ modelingMachine.ts:4779
start @ chunk-4HFCGIVX.js?v=b28049a9:2803
start @ chunk-4HFCGIVX.js?v=b28049a9:862
(anonymous) @ chunk-4HFCGIVX.js?v=b28049a9:1149
update @ chunk-4HFCGIVX.js?v=b28049a9:647
_process @ chunk-4HFCGIVX.js?v=b28049a9:902
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
onSubmit @ createMachineCommand.ts:109
Execute command @ commandBarMachine.ts:180
exec @ chunk-4HFCGIVX.js?v=b28049a9:605
actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:611
actorScope.actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:1884
resolveAndExecuteActionsWithContext @ chunk-4HFCGIVX.js?v=b28049a9:2114
resolveActionsAndContext @ chunk-4HFCGIVX.js?v=b28049a9:2152
microstep @ chunk-4HFCGIVX.js?v=b28049a9:1894
macrostep @ chunk-4HFCGIVX.js?v=b28049a9:2203
transition @ chunk-4HFCGIVX.js?v=b28049a9:3290
_process @ chunk-4HFCGIVX.js?v=b28049a9:884
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
send @ index.ts:76
out.<computed> @ helpers.ts:143
submitCommand @ CommandBarReview.tsx:78
executeDispatch @ react-dom_client.js?v=b28049a9:25652
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
processDispatchQueue @ react-dom_client.js?v=b28049a9:25688
(anonymous) @ react-dom_client.js?v=b28049a9:26101
batchedUpdates$1 @ react-dom_client.js?v=b28049a9:14656
dispatchEventForPluginEventSystem @ react-dom_client.js?v=b28049a9:25793
dispatchEvent @ react-dom_client.js?v=b28049a9:28814
dispatchDiscreteEvent @ react-dom_client.js?v=b28049a9:28795
<form>
process.env.NODE_ENV.exports.jsxDEV @ react_jsx-dev-runtime.js?v=b28049a9:270
CommandBarReview @ CommandBarReview.tsx:211
react_stack_bottom_frame @ react-dom_client.js?v=b28049a9:30539
renderWithHooks @ react-dom_client.js?v=b28049a9:17684
updateFunctionComponent @ react-dom_client.js?v=b28049a9:19505
beginWork @ react-dom_client.js?v=b28049a9:20555
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
performUnitOfWork @ react-dom_client.js?v=b28049a9:24591
workLoopSync @ react-dom_client.js?v=b28049a9:24454
renderRootSync @ react-dom_client.js?v=b28049a9:24438
performWorkOnRoot @ react-dom_client.js?v=b28049a9:23796
performSyncWorkOnRoot @ react-dom_client.js?v=b28049a9:25547
flushSyncWorkAcrossRoots_impl @ react-dom_client.js?v=b28049a9:25444
processRootScheduleInMicrotask @ react-dom_client.js?v=b28049a9:25467
(anonymous) @ react-dom_client.js?v=b28049a9:25561
<CommandBarReview>
process.env.NODE_ENV.exports.jsxDEV @ react_jsx-dev-runtime.js?v=b28049a9:270
CommandBar @ CommandBar.tsx:176
react_stack_bottom_frame @ react-dom_client.js?v=b28049a9:30539
renderWithHooks @ react-dom_client.js?v=b28049a9:17684
updateFunctionComponent @ react-dom_client.js?v=b28049a9:19505
beginWork @ react-dom_client.js?v=b28049a9:20555
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
performUnitOfWork @ react-dom_client.js?v=b28049a9:24591
workLoopSync @ react-dom_client.js?v=b28049a9:24454
renderRootSync @ react-dom_client.js?v=b28049a9:24438
performWorkOnRoot @ react-dom_client.js?v=b28049a9:23796
performSyncWorkOnRoot @ react-dom_client.js?v=b28049a9:25547
flushSyncWorkAcrossRoots_impl @ react-dom_client.js?v=b28049a9:25444
processRootScheduleInMicrotask @ react-dom_client.js?v=b28049a9:25467
(anonymous) @ react-dom_client.js?v=b28049a9:25561Understand this error
trap.ts:39 Error: edgeCut artifact has no edge_ids or consumedEdgeId; cannot resolve sweep
    at getSweepArtifactFromSelection (artifactGraph.ts:603:12)
    at groupSelectionsByBody (edges.ts:3294:27)
    at groupSelectionsByBodyAndAddTags (edges.ts:2968:28)
    at addFillet (edges.ts:176:16)
    at modelingMachine.ts:4779:27
    at Object.start (chunk-4HFCGIVX.js?v=b28049a9:2803:47)
    at Actor.start (chunk-4HFCGIVX.js?v=b28049a9:862:20)
    at chunk-4HFCGIVX.js?v=b28049a9:1149:14
    at Actor.update (chunk-4HFCGIVX.js?v=b28049a9:647:9)
    at Actor._process (chunk-4HFCGIVX.js?v=b28049a9:902:10)
err @ trap.ts:39
groupSelectionsByBody @ edges.ts:3295
groupSelectionsByBodyAndAddTags @ edges.ts:2968
addFillet @ edges.ts:176
(anonymous) @ modelingMachine.ts:4779
start @ chunk-4HFCGIVX.js?v=b28049a9:2803
start @ chunk-4HFCGIVX.js?v=b28049a9:862
(anonymous) @ chunk-4HFCGIVX.js?v=b28049a9:1149
update @ chunk-4HFCGIVX.js?v=b28049a9:647
_process @ chunk-4HFCGIVX.js?v=b28049a9:902
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
onSubmit @ createMachineCommand.ts:109
Execute command @ commandBarMachine.ts:180
exec @ chunk-4HFCGIVX.js?v=b28049a9:605
actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:611
actorScope.actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:1884
resolveAndExecuteActionsWithContext @ chunk-4HFCGIVX.js?v=b28049a9:2114
resolveActionsAndContext @ chunk-4HFCGIVX.js?v=b28049a9:2152
microstep @ chunk-4HFCGIVX.js?v=b28049a9:1894
macrostep @ chunk-4HFCGIVX.js?v=b28049a9:2203
transition @ chunk-4HFCGIVX.js?v=b28049a9:3290
_process @ chunk-4HFCGIVX.js?v=b28049a9:884
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
send @ index.ts:76
out.<computed> @ helpers.ts:143
submitCommand @ CommandBarReview.tsx:78
executeDispatch @ react-dom_client.js?v=b28049a9:25652
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
processDispatchQueue @ react-dom_client.js?v=b28049a9:25688
(anonymous) @ react-dom_client.js?v=b28049a9:26101
batchedUpdates$1 @ react-dom_client.js?v=b28049a9:14656
dispatchEventForPluginEventSystem @ react-dom_client.js?v=b28049a9:25793
dispatchEvent @ react-dom_client.js?v=b28049a9:28814
dispatchDiscreteEvent @ react-dom_client.js?v=b28049a9:28795
<form>
process.env.NODE_ENV.exports.jsxDEV @ react_jsx-dev-runtime.js?v=b28049a9:270
CommandBarReview @ CommandBarReview.tsx:211
react_stack_bottom_frame @ react-dom_client.js?v=b28049a9:30539
renderWithHooks @ react-dom_client.js?v=b28049a9:17684
updateFunctionComponent @ react-dom_client.js?v=b28049a9:19505
beginWork @ react-dom_client.js?v=b28049a9:20555
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
performUnitOfWork @ react-dom_client.js?v=b28049a9:24591
workLoopSync @ react-dom_client.js?v=b28049a9:24454
renderRootSync @ react-dom_client.js?v=b28049a9:24438
performWorkOnRoot @ react-dom_client.js?v=b28049a9:23796
performSyncWorkOnRoot @ react-dom_client.js?v=b28049a9:25547
flushSyncWorkAcrossRoots_impl @ react-dom_client.js?v=b28049a9:25444
processRootScheduleInMicrotask @ react-dom_client.js?v=b28049a9:25467
(anonymous) @ react-dom_client.js?v=b28049a9:25561
<CommandBarReview>
process.env.NODE_ENV.exports.jsxDEV @ react_jsx-dev-runtime.js?v=b28049a9:270
CommandBar @ CommandBar.tsx:176
react_stack_bottom_frame @ react-dom_client.js?v=b28049a9:30539
renderWithHooks @ react-dom_client.js?v=b28049a9:17684
updateFunctionComponent @ react-dom_client.js?v=b28049a9:19505
beginWork @ react-dom_client.js?v=b28049a9:20555
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
performUnitOfWork @ react-dom_client.js?v=b28049a9:24591
workLoopSync @ react-dom_client.js?v=b28049a9:24454
renderRootSync @ react-dom_client.js?v=b28049a9:24438
performWorkOnRoot @ react-dom_client.js?v=b28049a9:23796
performSyncWorkOnRoot @ react-dom_client.js?v=b28049a9:25547
flushSyncWorkAcrossRoots_impl @ react-dom_client.js?v=b28049a9:25444
processRootScheduleInMicrotask @ react-dom_client.js?v=b28049a9:25467
(anonymous) @ react-dom_client.js?v=b28049a9:25561Understand this error
trap.ts:39 Error: edgeCut artifact has no edge_ids or consumedEdgeId; cannot resolve sweep
    at getSweepArtifactFromSelection (artifactGraph.ts:603:12)
    at groupSelectionsByBodyAndAddTags (edges.ts:3034:26)
    at addFillet (edges.ts:176:16)
    at modelingMachine.ts:4779:27
    at Object.start (chunk-4HFCGIVX.js?v=b28049a9:2803:47)
    at Actor.start (chunk-4HFCGIVX.js?v=b28049a9:862:20)
    at chunk-4HFCGIVX.js?v=b28049a9:1149:14
    at Actor.update (chunk-4HFCGIVX.js?v=b28049a9:647:9)
    at Actor._process (chunk-4HFCGIVX.js?v=b28049a9:902:10)
    at Mailbox.flush (chunk-4HFCGIVX.js?v=b28049a9:107:12)
err @ trap.ts:39
groupSelectionsByBodyAndAddTags @ edges.ts:3035
addFillet @ edges.ts:176
(anonymous) @ modelingMachine.ts:4779
start @ chunk-4HFCGIVX.js?v=b28049a9:2803
start @ chunk-4HFCGIVX.js?v=b28049a9:862
(anonymous) @ chunk-4HFCGIVX.js?v=b28049a9:1149
update @ chunk-4HFCGIVX.js?v=b28049a9:647
_process @ chunk-4HFCGIVX.js?v=b28049a9:902
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
onSubmit @ createMachineCommand.ts:109
Execute command @ commandBarMachine.ts:180
exec @ chunk-4HFCGIVX.js?v=b28049a9:605
actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:611
actorScope.actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:1884
resolveAndExecuteActionsWithContext @ chunk-4HFCGIVX.js?v=b28049a9:2114
resolveActionsAndContext @ chunk-4HFCGIVX.js?v=b28049a9:2152
microstep @ chunk-4HFCGIVX.js?v=b28049a9:1894
macrostep @ chunk-4HFCGIVX.js?v=b28049a9:2203
transition @ chunk-4HFCGIVX.js?v=b28049a9:3290
_process @ chunk-4HFCGIVX.js?v=b28049a9:884
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
send @ index.ts:76
out.<computed> @ helpers.ts:143
submitCommand @ CommandBarReview.tsx:78
executeDispatch @ react-dom_client.js?v=b28049a9:25652
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
processDispatchQueue @ react-dom_client.js?v=b28049a9:25688
(anonymous) @ react-dom_client.js?v=b28049a9:26101
batchedUpdates$1 @ react-dom_client.js?v=b28049a9:14656
dispatchEventForPluginEventSystem @ react-dom_client.js?v=b28049a9:25793
dispatchEvent @ react-dom_client.js?v=b28049a9:28814
dispatchDiscreteEvent @ react-dom_client.js?v=b28049a9:28795
<form>
process.env.NODE_ENV.exports.jsxDEV @ react_jsx-dev-runtime.js?v=b28049a9:270
CommandBarReview @ CommandBarReview.tsx:211
react_stack_bottom_frame @ react-dom_client.js?v=b28049a9:30539
renderWithHooks @ react-dom_client.js?v=b28049a9:17684
updateFunctionComponent @ react-dom_client.js?v=b28049a9:19505
beginWork @ react-dom_client.js?v=b28049a9:20555
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
performUnitOfWork @ react-dom_client.js?v=b28049a9:24591
workLoopSync @ react-dom_client.js?v=b28049a9:24454
renderRootSync @ react-dom_client.js?v=b28049a9:24438
performWorkOnRoot @ react-dom_client.js?v=b28049a9:23796
performSyncWorkOnRoot @ react-dom_client.js?v=b28049a9:25547
flushSyncWorkAcrossRoots_impl @ react-dom_client.js?v=b28049a9:25444
processRootScheduleInMicrotask @ react-dom_client.js?v=b28049a9:25467
(anonymous) @ react-dom_client.js?v=b28049a9:25561
<CommandBarReview>
process.env.NODE_ENV.exports.jsxDEV @ react_jsx-dev-runtime.js?v=b28049a9:270
CommandBar @ CommandBar.tsx:176
react_stack_bottom_frame @ react-dom_client.js?v=b28049a9:30539
renderWithHooks @ react-dom_client.js?v=b28049a9:17684
updateFunctionComponent @ react-dom_client.js?v=b28049a9:19505
beginWork @ react-dom_client.js?v=b28049a9:20555
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
performUnitOfWork @ react-dom_client.js?v=b28049a9:24591
workLoopSync @ react-dom_client.js?v=b28049a9:24454
renderRootSync @ react-dom_client.js?v=b28049a9:24438
performWorkOnRoot @ react-dom_client.js?v=b28049a9:23796
performSyncWorkOnRoot @ react-dom_client.js?v=b28049a9:25547
flushSyncWorkAcrossRoots_impl @ react-dom_client.js?v=b28049a9:25444
processRootScheduleInMicrotask @ react-dom_client.js?v=b28049a9:25467
(anonymous) @ react-dom_client.js?v=b28049a9:25561Understand this error
trap.ts:39 Error: edgeCut has no edge_ids or consumedEdgeId
    at getEdgeCutConsumedCodeRef (artifactGraph.ts:362:12)
    at getCodeRefsByArtifactId (artifactGraph.ts:636:29)
    at createEdgeRefObjectExpression (edges.ts:907:22)
    at refactorZ0006Unified (edges.ts:2504:22)
    at computeZ0006RefactorSource (lintRefactorActions.ts:152:27)
    at getZ0006RefactorSource (lintRefactorActions.ts:175:12)
    at createZ0006Actions (lintRefactorActions.ts:201:27)
    at resolveRefactorLintActions (lintRefactorActions.ts:246:23)
    at async langHelpers.ts:199:32
    at async Promise.all (index 0)
err @ trap.ts:39
getCodeRefsByArtifactId @ artifactGraph.ts:637
createEdgeRefObjectExpression @ edges.ts:907
refactorZ0006Unified @ edges.ts:2504
computeZ0006RefactorSource @ lintRefactorActions.ts:152
getZ0006RefactorSource @ lintRefactorActions.ts:175
createZ0006Actions @ lintRefactorActions.ts:201
resolveRefactorLintActions @ lintRefactorActions.ts:246
await in resolveRefactorLintActions
(anonymous) @ langHelpers.ts:199
lintAst @ langHelpers.ts:177
await in lintAst
executeAst @ KclManager.ts:2416
await in executeAst
updateModelingState @ modelingWorkflows.ts:102
await in updateModelingState
(anonymous) @ modelingMachine.ts:4791
start @ chunk-4HFCGIVX.js?v=b28049a9:2803
start @ chunk-4HFCGIVX.js?v=b28049a9:862
(anonymous) @ chunk-4HFCGIVX.js?v=b28049a9:1149
update @ chunk-4HFCGIVX.js?v=b28049a9:647
_process @ chunk-4HFCGIVX.js?v=b28049a9:902
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
onSubmit @ createMachineCommand.ts:109
Execute command @ commandBarMachine.ts:180
exec @ chunk-4HFCGIVX.js?v=b28049a9:605
actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:611
actorScope.actionExecutor @ chunk-4HFCGIVX.js?v=b28049a9:1884
resolveAndExecuteActionsWithContext @ chunk-4HFCGIVX.js?v=b28049a9:2114
resolveActionsAndContext @ chunk-4HFCGIVX.js?v=b28049a9:2152
microstep @ chunk-4HFCGIVX.js?v=b28049a9:1894
macrostep @ chunk-4HFCGIVX.js?v=b28049a9:2203
transition @ chunk-4HFCGIVX.js?v=b28049a9:3290
_process @ chunk-4HFCGIVX.js?v=b28049a9:884
flush @ chunk-4HFCGIVX.js?v=b28049a9:107
enqueue @ chunk-4HFCGIVX.js?v=b28049a9:101
_send @ chunk-4HFCGIVX.js?v=b28049a9:997
_relay @ chunk-4HFCGIVX.js?v=b28049a9:452
send @ chunk-4HFCGIVX.js?v=b28049a9:1008
send @ index.ts:76
out.<computed> @ helpers.ts:143
submitCommand @ CommandBarReview.tsx:78
executeDispatch @ react-dom_client.js?v=b28049a9:25652
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
processDispatchQueue @ react-dom_client.js?v=b28049a9:25688
(anonymous) @ react-dom_client.js?v=b28049a9:26101
batchedUpdates$1 @ react-dom_client.js?v=b28049a9:14656
dispatchEventForPluginEventSystem @ react-dom_client.js?v=b28049a9:25793
dispatchEvent @ react-dom_client.js?v=b28049a9:28814
dispatchDiscreteEvent @ react-dom_client.js?v=b28049a9:28795Understand this error
lsp.ts:1192 [lsp] [window/publishDiagnostics] kcl {diagnostics: Array(1), uri: 'file:///documents/zoo-design-studio-projects/demo-project-2/main.kcl'}
trap.ts:39 Error: edgeCut has no edge_ids or consumedEdgeId
    at getEdgeCutConsumedCodeRef (artifactGraph.ts:362:12)
    at getCodeRefsByArtifactId (artifactGraph.ts:636:29)
    at createEdgeRefObjectExpression (edges.ts:907:22)
    at refactorZ0006Unified (edges.ts:2504:22)
    at KclManager.applyZ0006FixBeforeEdit (KclManager.ts:1245:23)
    at async applyZ0006FixAndReselectFeatureTreeOperation (FeatureTreePane.tsx:832:19)
    at async prepareFeatureTreeEditCommand (FeatureTreePane.tsx:865:23)
err @ trap.ts:39
getCodeRefsByArtifactId @ artifactGraph.ts:637
createEdgeRefObjectExpression @ edges.ts:907
refactorZ0006Unified @ edges.ts:2504
applyZ0006FixBeforeEdit @ KclManager.ts:1245
await in applyZ0006FixBeforeEdit
applyZ0006FixAndReselectFeatureTreeOperation @ FeatureTreePane.tsx:832
prepareFeatureTreeEditCommand @ FeatureTreePane.tsx:865
await in prepareFeatureTreeEditCommand
(anonymous) @ FeatureTreePane.tsx:1077
executeDispatch @ react-dom_client.js?v=b28049a9:25652
runWithFiberInDEV @ react-dom_client.js?v=b28049a9:13027
processDispatchQueue @ react-dom_client.js?v=b28049a9:25688
(anonymous) @ react-dom_client.js?v=b28049a9:26101
batchedUpdates$1 @ react-dom_client.js?v=b28049a9:14656
dispatchEventForPluginEventSystem @ react-dom_client.js?v=b28049a9:25793
dispatchEvent @ react-dom_client.js?v=b28049a9:28814
dispatchDiscreteEvent @ react-dom_client.js?v=b28049a9:28795Understand this error
modelingMachine.ts:1033 Error: bad ast
    at KclManager.updateAst (KclManager.ts:2640:54)

```

Seems pretty specific to the exact flow. Like, it's, it only happens when I use all point and click. Like, if I do the automatic refactor myself and do a hard refresh, and then add the first fillet, it lets me edit it. But when it does the refactor itself as part of, like, the edit from the feature tree, it dies. So, I think we probably need an end-to-end test that goes through very much like UI in a specific order in order to get a consistent replication. But we might circle back to that.


## 2.10. Shell topology consumed by Fillet and sketch-on-face

Shell removes a face and creates offset and rim topology. This tests both edge
and face selection after that replacement.

### KCL

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  bottom = line(start = [0, 0], end = [30, 0])
  right = line(start = [30, 0], end = [30, 22])
  top = line(start = [30, 22], end = [0, 22])
  left = line(start = [0, 22], end = [0, 0])
}
region001 = region(point = [15, 11], sketch = sketch001)
body001 = extrude(region001, length = 14, tagEnd = $endCap)
shell001 = shell(body001, faces = endCap, thickness = 2)

hide(sketch001)
```

### Workflow

1. Fillet an outer rim edge created by Shell.
2. Undo and Fillet one surviving outer vertical edge.
3. Start a sketch on an inner wall, draw a circle, and exit sketch mode.
4. Cancel a second sketch attempt on the narrow rim face.
5. Change shell thickness from `2` to `2.5`, then back to `2`.

### Expected result

Rim and surviving edges select correctly. Inner and outer faces remain distinct
for sketch-on-face. Cancelling sketch mode leaves the Shell and its code intact.

### Notes

straight await 1. fails with `argument: faces requires an array of 2 `TaggedFace`s (`[TaggedFace; 2]`), but found an array of `tagged edge` with 1 value (with type `[any; 1]`).` in the cmdbar flow

I do think we need to fix this because it works on main (albeit with edge(id), but that's okay we can fall back on that too.)


## 2.11. Distinct edge consumers on a cloned body

Revolve, Helix, and Mirror 3D do not use the fillet/chamfer edge-cut command.
Using the same cloned edge for all three isolates consumer behavior from
topology lineage.

### KCL

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

axisSketch = sketch(on = XY) {
  a1 = line(start = [0, 0], end = [10, 0])
  a2 = line(start = [10, 0], end = [10, 10])
  a3 = line(start = [10, 10], end = [0, 10])
  a4 = line(start = [0, 10], end = [0, 0])
}
axisRegion = region(point = [5, 5], sketch = axisSketch)
axisBody = extrude(axisRegion, length = 24, tagEnd = $axisEnd)
clonedAxisBody = clone(axisBody)
  |> translate(x = 24)

profileSketch = sketch(on = XZ) {
  circle1 = circle(center = [30, 5], radius = 2)
}
profileRegion = region(point = [30, 5], sketch = profileSketch)

mirrorSketch = sketch(on = XY) {
  m1 = line(start = [42, 2], end = [48, 2])
  m2 = line(start = [48, 2], end = [48, 8])
  m3 = line(start = [48, 8], end = [42, 8])
  m4 = line(start = [42, 8], end = [42, 2])
}
mirrorRegion = region(point = [45, 5], sketch = mirrorSketch)
mirrorBody = extrude(mirrorRegion, length = 6)

hide(axisSketch)
hide(profileSketch)
hide(mirrorSketch)
```

### Workflow

Use the same vertical edge of `clonedAxisBody`, undoing between cases:

1. Use it as the axis for a `180deg` Revolve of `profileRegion`.
2. Use it as the axis for a Helix with radius `2` and `3` revolutions.
3. Mirror `mirrorBody` across it.
4. For each operation, edit one numeric argument and confirm the axis remains
   unchanged.
5. Negative path: while Revolve requests an edge axis, Shift-select a face with
   the edge and confirm the mixed selection is rejected.

### Expected result

All three operations generate an edge-reference payload for the same cloned
edge and produce geometry around/across that edge. Command transitions clear
the previously selected profile before requesting the axis.

### Notes

I only tried with Helix, and it didn't work, and since it also doesn't work in main, I think these are all not going to work until it's fixed in main, because this is ultimately to do with, like, clones and IDs and not related to face API. So I'm just gonna leave this one for now, I think.


## 2.12. Surface edge extrusion after CSG

Surface extrusion consumes an edge reference as a source rather than as an
edge-cut or axis. It therefore needs separate coverage after a topology-changing
operation.

### KCL

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

baseSketch = sketch(on = XY) {
  b1 = line(start = [0, 0], end = [26, 0])
  b2 = line(start = [26, 0], end = [26, 18])
  b3 = line(start = [26, 18], end = [0, 18])
  b4 = line(start = [0, 18], end = [0, 0])
}
baseRegion = region(point = [13, 9], sketch = baseSketch)
baseBody = extrude(baseRegion, length = 10, tagEnd = $baseEnd)

toolSketch = sketch(on = YZ) {
  t1 = line(start = [-2, 4], end = [12, 4])
  t2 = line(start = [12, 4], end = [12, 14])
  t3 = line(start = [12, 14], end = [-2, 14])
  t4 = line(start = [-2, 14], end = [-2, 4])
}
toolRegion = region(point = [5, 9], sketch = toolSketch)
toolBody = extrude(toolRegion, length = 30, symmetric = true)
cutBody = subtract(baseBody, tools = toolBody)

hide(baseSketch)
hide(toolSketch)
```

### Workflow

1. Select an untouched outer edge of `cutBody` and create a surface Extrude
   with `bodyType = SURFACE`, `method = NEW`, and length `6`.
2. Undo and repeat using a new concave edge created by the subtraction.
3. Change the surface extrusion length from `6` to `7`, then back to `6`.
4. Negative path: select a face instead of an edge and start Extrude.
5. Negative path: select two unrelated edges from different parts of the CSG
   result and confirm the command either handles both explicitly or rejects the
   selection.

### Expected result

The generated surface starts from the clicked CSG edge and remains visible
after re-execution. A face is not silently coerced into an edge. Multiple source
edges must not be collapsed into one arbitrary selector.

### Notes

Okay, this workflow differs quite a bit from what we see on main. So, what happens is I select an edge, any edge I tried with a number of ones, but no matter what edge I select, it always grabs the face of, like, one of the faces that the edge is attached to, and extrudes the entire face. And, but there's even a difference in flow that when I do this on main, so, like, it works on main, main automatically opens up both the surface type, or I think it's called, is it type, with surface or solid, it gives me that option. And then I click surface, because I'm pretty sure these have to be surface. And then the next thing, it automatically opens the method, of which I will select new, and then it, you know, successfully extrudes the edge. However, on our branch, it only asks about the surface, surface or solid, and never, never opens up the method, like, command flow. And if I manually open it up, I can select it, but that still doesn't seem to affect things. It still will extrude the entire face connected to that edge instead of the edge itself. So, yeah, definitely something's gone wrong here. We probably, because it's, like, related to the flow and selections, we probably need an end-to-end test, right?

## Test session 2 completion summary

- Tests passed:
- Tests failed only on this branch:
- Tests also failed on deployed `main`:
- Cases that selected the wrong edge:
- Cases that generated `faceId(...)` or raw UUIDs:
- Cases that could not express a stable edge reference:
- Console errors worth investigating:
- Follow-up tests or issues:
