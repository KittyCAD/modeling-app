---
title: "extrude"
subtitle: "Function in std::sketch"
excerpt: "Extend a 2-dimensional sketch through a third dimension in order to create new 3-dimensional volume, or if extruded into an existing volume, cut into an existing solid."
layout: manual
---

Extend a 2-dimensional sketch through a third dimension in order to create new 3-dimensional volume, or if extruded into an existing volume, cut into an existing solid.

```kcl
extrude(
  @sketches: [Sketch; 1+],
  length?: number(Length),
  to?: Point3d | Axis3d | Plane | Edge | Face | Sketch | Solid | TaggedEdge | TaggedFace,
  symmetric?: bool,
  bidirectionalLength?: number(Length),
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  twistAngle?: number(Angle),
  twistAngleStep?: number(Angle),
  twistCenter?: Point2d,
  method?: string,
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
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] | Which sketch or sketches should be extruded. | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | How far to extrude the given sketches. Incompatible with `to`. | No |
| `to` | [`Point3d`](/docs/kcl-std/types/std-types-Point3d) or [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Face`](/docs/kcl-std/types/std-types-Face) or [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Solid`](/docs/kcl-std/types/std-types-Solid) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Reference to extrude to. Incompatible with `length` and `twistAngle`. | No |
| `symmetric` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the extrusion will happen symmetrically around the sketch. Otherwise, the extrusion will happen on only one side of the sketch. | No |
| `bidirectionalLength` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | If specified, will also extrude in the opposite direction to 'distance' to the specified distance. If 'symmetric' is true, this value is ignored. | No |
| `tagStart` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the start of the extrusion, i.e. the original sketch. | No |
| `tagEnd` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the end of the extrusion, i.e. the new face created by extruding the original sketch. | No |
| `twistAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | If given, the sketch will be twisted around this angle while being extruded. Incompatible with `to`. | No |
| `twistAngleStep` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The size of each intermediate angle as the sketch twists around. Must be between 4 and 90 degrees. Only used if `twistAngle` is given, defaults to 15 degrees. | No |
| `twistCenter` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center around which the sketch will be twisted. Relative to the sketch's center. Only used if `twistAngle` is given, defaults to [0, 0] i.e. sketch's center. | No |
| `method` | [`string`](/docs/kcl-std/types/std-types-string) | The method used during extrusion, either `NEW` or `MERGE`. `NEW` creates a new object. `MERGE` merges the extruded objects together. The default is `MERGE`. | No |

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
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


