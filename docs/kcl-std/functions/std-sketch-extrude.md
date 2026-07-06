---
title: "extrude"
subtitle: "Function in std::sketch"
excerpt: "Extend a 2-dimensional sketch or individual segment of a sketch through a third dimension to create a new 3-dimensional volume or surface, or if extruded into an existing volume, cut into an existing solid."
layout: manual
---

Extend a 2-dimensional sketch or individual segment of a sketch through a third dimension to create a new 3-dimensional volume or surface, or if extruded into an existing volume, cut into an existing solid.

```kcl
extrude(
  @sketches: [Sketch | Face | TaggedFace | TaggedEdge | Edge | Segment; 1+],
  length?: number(Length),
  to?: Point3d | Axis3d | Plane | Edge | Face | Sketch | Solid | TaggedEdge | TaggedFace | any,
  symmetric?: bool,
  direction?: Point3d | Edge | TaggedEdge | Segment,
  bidirectionalLength?: number(Length),
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  draftAngle?: number(Angle),
  twistAngle?: number(Angle),
  twistAngleStep?: number(Angle),
  twistCenter?: Point2d,
  method?: string,
  hideSeams?: bool,
  bodyType?: string,
): [Solid; 1+]
```

You can provide more than one sketch to extrude, and they will all be
extruded in the same direction.

When you sketch on a face of a solid, extruding extends or cuts into the
existing solid, meaning you don't need to union or subtract the volumes. You
can change this behavior by using the `method` parameter. See
[sketch on face](/docs/kcl-lang/sketch-on-face) for more details.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Face`](/docs/kcl-std/types/std-types-Face) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | Which sketch or sketches should be extruded. | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | How far to extrude the given sketches. Incompatible with `to`. | No |
| `to` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) or [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Face`](/docs/kcl-std/types/std-types-Face) or [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Solid`](/docs/kcl-std/types/std-types-Solid) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`any`](/docs/kcl-std/types/std-types-any) | Reference to extrude to. Incompatible with `length` and `twistAngle`. Not currently supported for extruding edges. Experimental face API: edge specifier objects (`{ sideFaces = [faceTag1, faceTag2], endFaces? = [...], index? }`) are not ready for generated or user-facing KCL yet; prefer existing point, axis, plane, edge, face, sketch, solid, or tag forms until point-and-click and migration support ships. | No |
| `symmetric` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the extrusion will happen symmetrically around the sketch. Otherwise, the extrusion will happen on only one side of the sketch. | No |
| `direction` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | **Experimental.** If specified, will extrude in this direction instead of the sketch plane normal. If an edge is being extruded, this defaults to halfway between the faces on either side of the edge. | No |
| `bidirectionalLength` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | If specified, will also extrude in the opposite direction to 'distance' to the specified distance. If 'symmetric' is true, this value is ignored. | No |
| `tagStart` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the start of the extrusion, i.e. the original sketch. | No |
| `tagEnd` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the end of the extrusion, i.e. the new face created by extruding the original sketch. | No |
| `draftAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | **Experimental.** Positive draft angle means the sketch gets smaller while extruding, i.e. inwards draft. Negative draft angle means the sketch gets bigger while extruding, i.e. outwards draft. Defaults to zero, i.e. no draft. | No |
| `twistAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | If given, the sketch will be twisted around this angle while being extruded. Incompatible with `to`. | No |
| `twistAngleStep` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The size of each intermediate angle as the sketch twists around. Must be between 4 and 90 degrees. Only used if `twistAngle` is given, defaults to 15 degrees. | No |
| `twistCenter` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center around which the sketch will be twisted. Relative to the plane's origin. Only used if `twistAngle` is given, defaults to [0, 0] i.e. plane origin. | No |
| `method` | [`string`](/docs/kcl-std/types/std-types-string) | The method used during extrusion, either `NEW` or `MERGE`. `NEW` creates a new object. `MERGE` merges the extruded objects together. The default is `MERGE`. | No |
| `hideSeams` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether or not to hide the seams between the original and resulting object. Only used if a face is extruded and method = MERGE | No |
| `bodyType` | [`string`](/docs/kcl-std/types/std-types-string) | What type of body to produce (solid or surface). Defaults to "solid". | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
example = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> arc(angleStart = 120deg, angleEnd = 0, radius = 5)
  |> line(end = [5, 0])
  |> line(end = [0, 10])
  |> bezierCurve(control1 = [-10, 0], control2 = [2, 10], end = [-5, 10])
  |> line(end = [-5, -2])
  |> close()
  |> extrude(length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [-10, 0])
  |> arc(angleStart = 120deg, angleEnd = -60deg, radius = 5)
  |> line(end = [10, 0])
  |> line(end = [5, 0])
  |> bezierCurve(control1 = [-3, 0], control2 = [2, 10], end = [-5, 10])
  |> line(end = [-4, 10])
  |> line(end = [-5, -2])
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [-10, 0])
  |> arc(angleStart = 120deg, angleEnd = -60deg, radius = 5)
  |> line(end = [10, 0])
  |> line(end = [5, 0])
  |> bezierCurve(control1 = [-3, 0], control2 = [2, 10], end = [-5, 10])
  |> line(end = [-4, 10])
  |> line(end = [-5, -2])
  |> close()

example = extrude(exampleSketch, length = 20, symmetric = true)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [-10, 0])
  |> arc(angleStart = 120deg, angleEnd = -60deg, radius = 5)
  |> line(end = [10, 0])
  |> line(end = [5, 0])
  |> bezierCurve(control1 = [-3, 0], control2 = [2, 10], end = [-5, 10])
  |> line(end = [-4, 10])
  |> line(end = [-5, -2])
  |> close()

example = extrude(exampleSketch, length = 10, bidirectionalLength = 50)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
example = startSketchOn(XZ)
  |> polygon(radius = 10, numSides = 3, center = [0, 0])
  |> extrude(length = 10, twistAngle = 120deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch a square in the corner of the scene.
startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> polygon(radius = 1, numSides = 10, center = [4, 4])
  // Because the twist defaults to the plane's center, this makes a spiral shape.
  |> extrude(length = 10, twistAngle = 360deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 1)
  |> xLine(length = 1)
  |> yLine(length = -1)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
cube = extrude(profile001, length = 1)

sketch002 = startSketchOn(cube, face = END)
profile002 = circle(sketch002, center = [0.38, 0.64], radius = 0.13)
// When sketching on a face, we can make a new solid instead of merging with
// it by using the method parameter.
cylinder = extrude(profile002, length = 2, method = NEW)

// The cylinder is a separate solid that can be translated separately from
// the cube.
translate(cylinder, x = 1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// You could also use the 'to' parameter if you want extrusions
// to end at a reference point, axis, scene geometry, tagged geometry, or plane.

sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [2, 2])
  |> yLine(length = 1)
  |> xLine(length = 1)
  |> yLine(length = -1, tag = $facetag0)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)], tag = $facetag1)
  |> close()
cube = extrude(profile001, length = 1)

// extrude a circle to a point reference (red cylinder)
sketch002 = startSketchOn(XZ)
cylinder0 = circle(sketch002, center = [0.5, 0.5], radius = 0.25)
  |> extrude(to = [-2, -3, -4])
  |> appearance(color = '#FF0000')

// extrude a circle to an axis reference (green cylinder)
sketch003 = startSketchOn(offsetPlane(XY, offset = -2))
cylinder1 = circle(sketch003, center = [0.5, 0.5], radius = 0.25)
  |> extrude(to = Y)
  |> appearance(color = '#00FF00')

// extrude a circle to a solid reference (blue cylinder)
sketch004 = startSketchOn(offsetPlane(YZ, offset = -1))
cylinder2 = circle(sketch004, center = [0.5, 0.5], radius = 0.25)
  |> extrude(to = cube)
  |> appearance(color = '#0000FF')

// extrude a circle to a tagged edge (cyan cylinder)
sketch005 = startSketchOn(offsetPlane(YZ, offset = 4))
cylinder3 = circle(sketch005, center = [0.5, 0.5], radius = 0.25)
  |> extrude(to = getCommonEdge(faces = [facetag0, facetag1]))
  |> appearance(color = '#00FFFF')

// extrude a circle to a plane (magenta cylinder)
sketch006 = startSketchOn(cube, face = facetag1)
cylinder4 = circle(sketch006, center = [2.5, 0.5], radius = 0.25)
  |> extrude(to = XZ, method = NEW)
  |> appearance(color = '#FF00FF')

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Surface extrude of an open profile
openProfile = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [4, 0])
  |> arc(angleStart = 120deg, angleEnd = 0, radius = 5)
  |> line(end = [5, 0])
  |> line(end = [0, 10])
// Surface extrude
extrude(openProfile, length = 2, bodyType = SURFACE)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude8_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude8.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Extrude a face from an extruded object
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-5, 0])
  |> xLine(length = 1)
  |> yLine(length = -1)
  |> line(end = [-1, -1], tag = $seg01)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 5)
extrude(
  seg01,
  length = 2,
  method = MERGE,
  hideSeams = false,
)
  // if hideSeams=true, the seam still shows because the edges of the coplanar faces are not colinear
  |> appearance(color = "#ff0000")

// Extrude a face from an extruded object to create a new object
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [-1, 0])
  |> yLine(length = -1.0)
  |> xLine(length = 1.0, tag = $seg02)
  |> yLine(length = 1.0)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 5)
extrude(
  seg02,
  length = 2,
  method = NEW,
  hideSeams = false,
)
  // if hideSeams=true, the seam still shows because the resulting extrusion is a separate object
  |> appearance(color = "#00ff00")

// Extrude a face from an extruded object and merge the result
sketch003 = startSketchOn(XY)
profile003 = startProfile(sketch003, at = [1, 0])
  |> yLine(length = -1.0)
  |> xLine(length = 1.0, tag = $seg03)
  |> yLine(length = 1.0)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 5)
extrude(
  seg03,
  length = 2,
  method = MERGE,
  hideSeams = true,
)
  |> appearance(color = "#0000ff")

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude9_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude9.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Create a yellow extruded triangle.
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [0, 0])
  |> yLine(length = 1, tag = $a)
  |> xLine(length = 1, tag = $b)
  |> close(tag = $c)
cube = extrude(profile001, length = 1)
  |> appearance(color = "#ffaa00")

// Extrude a red box from one of the triangle's side faces.
box = extrude(
  c,
  length = 4,
  hideSeams = false,
  method = NEW,
)
  |> appearance(color = "#ff0000")

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude10_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude10.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// You can even extrude faces from sweeps!
// In this example, the sweep is blue,
// and the extrusion from its end face is yellow
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-1.0, 1.0])
  |> yLine(length = -2.0)
  |> xLine(length = 2.0)
  |> yLine(length = 2.0)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
sketch003 = startSketchOn(XZ)
profile002 = startProfile(sketch003, at = [0, 0])
  |> yLine(length = 2.0)
  |> tangentialArc(end = [-2.0, 2.0])
  |> xLine(length = -2.0)
  |> tangentialArc(end = [-2, 2.0])
  |> yLine(length = 2)
sweep001 = sweep(profile001, path = profile002, tagEnd = $endSweep)
  |> appearance(color = "#0000FF")
extrude(endSweep, length = 2, method = NEW)
  |> appearance(color = "#FFFF00")

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude11_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude11.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Examples showing extrude with a positive/negative draft.
@settings(experimentalFeatures = allow, kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var -3.39mm, var 2.51mm], end = [var -4.52mm, var 0.96mm])
  line2 = line(start = [var -4.52mm, var 0.96mm], end = [var -2.45mm, var 0.96mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var -2.45mm, var 0.96mm], end = [var -3.39mm, var 2.51mm])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.start])
  line4 = line(start = [var 1.62mm, var 2.61mm], end = [var 0.65mm, var 0.91mm])
  line5 = line(start = [var 0.65mm, var 0.91mm], end = [var 2.64mm, var 0.91mm])
  coincident([line4.end, line5.start])
  line6 = line(start = [var 2.64mm, var 0.91mm], end = [var 1.62mm, var 2.61mm])
  coincident([line5.end, line6.start])
  coincident([line6.end, line4.start])
  line7 = line(start = [var -1.2mm, var 2.56mm], end = [var -1.89mm, var 0.85mm])
  line8 = line(start = [var -1.89mm, var 0.85mm], end = [var -0.33mm, var 0.85mm])
  coincident([line7.end, line8.start])
  line9 = line(start = [var -0.33mm, var 0.85mm], end = [var -1.2mm, var 2.56mm])
  coincident([line8.end, line9.start])
  coincident([line9.end, line7.start])
}

// Three triangular regions
region001 = region(point = [-3.9529799mm, 1.7335272mm], sketch = sketch001)
region002 = region(point = [1.1371714mm, 1.758761mm], sketch = sketch001)
region003 = region(point = [-1.5426816mm, 1.7040645mm], sketch = sketch001)
hidden001 = hide(sketch001)

// Extrude the regions, with a positive draft, negative draft, and no draft at all.
// Positive draft means the sketch gets _smaller_ as it gets extruded.
positiveDraft = extrude(region001, length = 2, draftAngle = 30deg)
// Negative draft means the sketch gets _bigger_ as it gets extruded.
negativeDraft = extrude(region002, length = 2, draftAngle = -30deg)
// No draft means the sketch stays the exact same size as it gets extruded.
zeroDraft = extrude(region003, length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude12_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude12.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Surface extrude of a closed profile
closedProfile = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> circle(center = [0, 0], diameter = 10)
// Surface extrude
extrude(closedProfile, length = 5, bodyType = SURFACE)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude13_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude13.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  edge2 = line(start = [var 5mm, var 0mm], end = [var 5mm, var 3mm])
  edge3 = line(start = [var 5mm, var 3mm], end = [var 0mm, var 3mm])
  edge4 = line(start = [var 0mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude14_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude14.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch some disconnected lines in a sketch block.
originalSketch = sketch(on = YZ) {
  line1 = line(start = [var -5.33mm, var 3.69mm], end = [var -5.93mm, var -2.59mm])
  line2 = line(start = [var -0.9mm, var 0.63mm], end = [var 4.01mm, var 0.68mm])
}

// Surface extrudes of sketch blocks let you extrude any lines.
extrude(
  [
    originalSketch.line1,
    originalSketch.line2
  ],
  length = 1,
  bodyType = SURFACE,
)

// Surface extrudes of sketch blocks are non-destructive: they leave the original sketch
// in place. So we can add another extrude of the same lines, in a different direction.
extrude(
  [
    originalSketch.line1,
    originalSketch.line2
  ],
  length = -1,
  bodyType = SURFACE,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude15_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude15.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// The direction parameter can apply to sketches, segments, or edges
// Directions can be specified by an axis, a sketch segment, or a body's edge.
sketch001 = sketch(on = XY) {
  point1 = point(at = [var -3.75mm, var 4.46mm])
  arc1 = arc(start = [var -2.74mm, var 2.1mm], end = [var -4.84mm, var 3.42mm], center = [var -3.54mm, var 3.15mm])
  coincident([point1, arc1])
  point2 = point(at = [var -2.99mm, var -0.59mm])
  arc2 = arc(start = [var -3.51mm, var -0.28mm], end = [var -2.74mm, var 2.1mm], center = [var -2.57mm, var 0.73mm])
  coincident([arc2.end, arc1.start])
  coincident([point2, arc2])
  point4 = point(at = [var -4.72mm, var -1.43mm])
  arc3 = arc(start = [var -5.62mm, var 1.09mm], end = [var -3.51mm, var -0.28mm], center = [var -4.87mm, var -0.06mm])
  coincident([point4, arc3])
  point5 = point(at = [var -6.76mm, var 1.96mm])
  arc4 = arc(start = [var -4.84mm, var 3.42mm], end = [var -5.62mm, var 1.09mm], center = [var -5.55mm, var 2.36mm])
  coincident([arc4.start, arc1.end])
  coincident([point5, arc4])
  coincident([arc3.start, arc4.end])
  coincident([arc3.end, arc2.start])
}
hidden001 = hide(sketch001)
region001 = region(point = [-2.8386997mm, 4.2713868mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5, direction = [-1, 0, 1])
sketch002 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 3.96mm], end = [var 0mm, var 0mm])
  vertical([line1.start, ORIGIN])
  coincident([line1.end, ORIGIN])
  line2 = line(start = [var 0mm, var 0mm], end = [var 4.32mm, var -1.23mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 4.32mm, var -1.23mm], end = [var 4.35mm, var 3.86mm])
  coincident([line2.end, line3.start])
  line4 = line(start = [var 4.35mm, var 3.86mm], end = [var 0mm, var 3.96mm])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}
extrude002 = extrude(
  sketch002.line2,
  length = 5,
  bodyType = SURFACE,
  direction = sketch002.line1,
)
sketch003 = sketch(on = XY) {
  point1 = point(at = [var 9.39mm, var 4.29mm])
  arc1 = arc(start = [var 12.92mm, var 0.56mm], end = [var 7.39mm, var 1.09mm], center = [var 10.23mm, var 1.54mm])
  coincident([point1, arc1])
  line1 = line(start = [var 12.92mm, var 0.56mm], end = [var 10.26mm, var -6.33mm])
  coincident([line1.start, arc1.start])
  line2 = line(start = [var 10.26mm, var -6.33mm], end = [var 7.39mm, var 1.09mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, arc1.end])
}
extrude003 = extrude(
  sketch003.arc1,
  length = 5,
  bodyType = SURFACE,
  direction = [1, -1, 1],
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude16_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude16.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(kclVersion = 2.0)

// Extruding edges can infer a direction or accept a custom direction
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 1.84mm, var -0.32mm], center = [var -1.32mm, var 0mm])
  horizontal([circle1.center, ORIGIN])
  circle2 = circle(start = [var 3.37mm, var 2.21mm], center = [var 0mm, var 1.52mm])
  vertical([circle2.center, ORIGIN])
  line1 = line(start = [var -6.36mm, var -3.01mm], end = [var 3.61mm, var 6.24mm])
}
hidden001 = hide(sketch001)
region001 = region(point = [1.6952577mm, -0.9901244mm], sketch = sketch001)
extrude001 = extrude(region001, length = 5, bodyType = SURFACE)
sketch002 = sketch(on = XY) {
  line1 = line(start = [var -9.26mm, var 4.04mm], end = [var -3.48mm, var 5.98mm])
}

a = extrude001.sketch.tags.line1
// b = getPreviousAdjacentEdge(a)
b = getOppositeEdge(a)

extrude002 = extrude(
  b,
  length = 6.7,
  bodyType = SURFACE,
  method = NEW,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude17_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude17.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


