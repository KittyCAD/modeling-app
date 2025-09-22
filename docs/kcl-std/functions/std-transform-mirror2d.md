---
title: "mirror2d"
subtitle: "Function in std::transform"
excerpt: "Mirror a sketch."
layout: manual
---

Mirror a sketch.

```kcl
mirror2d(
  @sketches: [Sketch; 1+],
  axis: Axis2d | Edge,
): Sketch
```

Mirror occurs around a local sketch axis rather than a global axis.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [`[Sketch; 1+]`](/docs/kcl-std/types/std-types-Sketch) | The sketch or sketches to be reflected. | Yes |
| `axis` | [`Axis2d`](/docs/kcl-std/types/std-types-Axis2d) or [`Edge`](/docs/kcl-std/types/std-types-Edge) | The axis to reflect around. | Yes |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
// Mirror an un-closed sketch across the Y axis.
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 10])
  |> line(end = [15, 0])
  |> line(end = [-7, -3])
  |> line(end = [9, -1])
  |> line(end = [-8, -5])
  |> line(end = [9, -3])
  |> line(end = [-8, -3])
  |> line(end = [9, -1])
  |> line(end = [-19, -0])
  |> mirror2d(axis = Y)

example = extrude(sketch001, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror2d0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror2d0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Mirror a un-closed sketch across the Y axis.
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 8.5])
  |> line(end = [20, -8.5])
  |> line(end = [-20, -8.5])
  |> mirror2d(axis = Y)

example = extrude(sketch001, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror2d1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror2d1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Mirror a un-closed sketch across an edge.
helper001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 10], tag = $edge001)

sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 8.5])
  |> line(end = [20, -8.5])
  |> line(end = [-20, -8.5])
  |> mirror2d(axis = edge001)

// example = extrude(sketch001, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror2d2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror2d2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Mirror an un-closed sketch across a custom axis.
sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 8.5])
  |> line(end = [20, -8.5])
  |> line(end = [-20, -8.5])
  |> mirror2d(axis = {
       direction = [0.0, 1.0],
       origin = [0.0, 0.0]
     })

example = extrude(sketch001, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror2d3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror2d3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch on the face of a mirrored sketch, that has been extruded.
sketch0011 = startSketchOn(XY)
  |> startProfile(at = [6.77, 0])
  |> yLine(length = 1.27)
  |> tangentialArc(endAbsolute = [5.96, 2.37])
  |> tangentialArc(endAbsolute = [-6.2, 2.44])
  |> tangentialArc(endAbsolute = [-6.6, 1.82])
  |> yLine(length = -1.82)
  |> mirror2d(axis = X)
  |> extrude(length = 10)

sketch002 = startSketchOn(sketch0011, face = END)
  |> circle(center = [-0.01, 1.58], radius = 1.2)
  |> extrude(length = 1.2)

shell([sketch002], faces = [END], thickness = .1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror2d4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror2d4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


