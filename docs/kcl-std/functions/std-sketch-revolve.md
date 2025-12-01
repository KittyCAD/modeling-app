---
title: "revolve"
subtitle: "Function in std::sketch"
excerpt: "Rotate a sketch around some provided axis, creating a solid from its extent."
layout: manual
---

Rotate a sketch around some provided axis, creating a solid from its extent.

```kcl
revolve(
  @sketches: [Sketch; 1+],
  axis: Axis2d | Edge,
  angle?: number(Angle),
  tolerance?: number(Length),
  symmetric?: bool,
  bidirectionalAngle?: number(Angle),
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
): [Solid; 1+]
```

This, like extrude, is able to create a 3-dimensional solid from a
2-dimensional sketch. However, unlike extrude, this creates a solid
by using the extent of the sketch as its revolved around an axis rather
than using the extent of the sketch linearly translated through a third
dimension.

Revolve occurs around a local sketch axis rather than a global axis.

You can provide more than one sketch to revolve, and they will all be
revolved around the same axis.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] | The sketch or set of sketches that should be revolved | Yes |
| `axis` | [`Axis2d`](/docs/kcl-std/types/std-types-Axis2d) or [`Edge`](/docs/kcl-std/types/std-types-Edge) | Axis of revolution. | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Angle to revolve (in degrees). Default is 360. | No |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `symmetric` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the extrusion will happen symmetrically around the sketch. Otherwise, the extrusion will happen on only one side of the sketch. | No |
| `bidirectionalAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | If specified, will also revolve in the opposite direction to 'angle' to the specified angle. If 'symmetric' is true, this value is ignored. | No |
| `tagStart` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the start of the revolve, i.e. the original sketch. | No |
| `tagEnd` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the end of the revolve. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
part001 = startSketchOn(XY)
  |> startProfile(at = [4, 12])
  |> line(end = [2, 0])
  |> line(end = [0, -6])
  |> line(end = [4, -6])
  |> line(end = [0, -6])
  |> line(end = [-3.75, -4.5])
  |> line(end = [0, -5.5])
  |> line(end = [-2, 0])
  |> close()
  |> revolve(axis = Y) // default angle is 360deg

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// A donut shape.
sketch001 = startSketchOn(XY)
  |> circle(center = [15, 0], radius = 5)
  |> revolve(angle = 360deg, axis = Y)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
part001 = startSketchOn(XY)
  |> startProfile(at = [4, 12])
  |> line(end = [2, 0])
  |> line(end = [0, -6])
  |> line(end = [4, -6])
  |> line(end = [0, -6])
  |> line(end = [-3.75, -4.5])
  |> line(end = [0, -5.5])
  |> line(end = [-2, 0])
  |> close()
  |> revolve(axis = Y, angle = 180deg)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
part001 = startSketchOn(XY)
  |> startProfile(at = [4, 12])
  |> line(end = [2, 0])
  |> line(end = [0, -6])
  |> line(end = [4, -6])
  |> line(end = [0, -6])
  |> line(end = [-3.75, -4.5])
  |> line(end = [0, -5.5])
  |> line(end = [-2, 0])
  |> close()
  |> revolve(axis = Y, angle = 180deg)

part002 = startSketchOn(part001, face = END)
  |> startProfile(at = [4.5, -5])
  |> line(end = [0, 5])
  |> line(end = [5, 0])
  |> line(end = [0, -5])
  |> close()
  |> extrude(length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
box = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20])
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> close()
  |> extrude(length = 20)

sketch001 = startSketchOn(box, face = END)
  |> circle(center = [10, 10], radius = 4)
  |> revolve(angle = -90deg, axis = Y)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
box = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20])
  |> line(end = [20, 0])
  |> line(end = [0, -20], tag = $revolveAxis)
  |> close()
  |> extrude(length = 20)

sketch001 = startSketchOn(box, face = END)
  |> circle(center = [10, 10], radius = 4)
  |> revolve(angle = 90deg, axis = getOppositeEdge(revolveAxis))

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
box = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20])
  |> line(end = [20, 0])
  |> line(end = [0, -20], tag = $revolveAxis)
  |> close()
  |> extrude(length = 20)

sketch001 = startSketchOn(box, face = END)
  |> circle(center = [10, 10], radius = 4)
  |> revolve(angle = 90deg, axis = getOppositeEdge(revolveAxis), tolerance = 0.0001)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sketch001 = startSketchOn(XY)
  |> startProfile(at = [10, 0])
  |> line(end = [5, -5])
  |> line(end = [5, 5])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

part001 = revolve(
  sketch001,
  axis = {
    direction = [0.0, 1.0],
    origin = [0.0, 0.0]
  },
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Revolve two sketches around the same axis.


sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [4, 8])
  |> xLine(length = 3)
  |> yLine(length = -3)
  |> xLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

profile002 = startProfile(sketch001, at = [-5, 8])
  |> xLine(length = 3)
  |> yLine(length = -3)
  |> xLine(length = -3)
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

revolve([profile001, profile002], axis = X)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve8_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve8.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Revolve around a path that has not been extruded.


profile001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20], tag = $revolveAxis)
  |> line(end = [20, 0])
  |> line(end = [0, -20])
  |> close(%)

sketch001 = startSketchOn(XY)
  |> circle(center = [-10, 10], radius = 4)
  |> revolve(angle = 90deg, axis = revolveAxis)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve9_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve9.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Revolve around a path that has not been extruded or closed.


profile001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20], tag = $revolveAxis)
  |> line(end = [20, 0])

sketch001 = startSketchOn(XY)
  |> circle(center = [-10, 10], radius = 4)
  |> revolve(angle = 90deg, axis = revolveAxis)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve10_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve10.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Symmetrically revolve around a path.


profile001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20], tag = $revolveAxis)
  |> line(end = [20, 0])

sketch001 = startSketchOn(XY)
  |> circle(center = [-10, 10], radius = 4)
  |> revolve(angle = 90deg, axis = revolveAxis, symmetric = true)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve11_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve11.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Bidirectional revolve around a path.


profile001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20], tag = $revolveAxis)
  |> line(end = [20, 0])

sketch001 = startSketchOn(XY)
  |> circle(center = [-10, 10], radius = 4)
  |> revolve(angle = 90deg, axis = revolveAxis, bidirectionalAngle = 50)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the revolve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-revolve12_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-revolve12.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


