---
title: "sweep"
subtitle: "Function in std::sketch"
excerpt: "Extrude a sketch along a path."
layout: manual
---

Extrude a sketch along a path.

```kcl
sweep(
  @sketches: [Sketch; 1+],
  path: Sketch | Helix,
  sectional?: bool,
  tolerance?: number(Length),
  relativeTo?: string,
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
): [Solid; 1+]
```

This, like extrude, is able to create a 3-dimensional solid from a
2-dimensional sketch. However, unlike extrude, this creates a solid
by using the extent of the sketch as its path. This is useful for
creating more complex shapes that can't be created with a simple
extrusion.

You can provide more than one sketch to sweep, and they will all be
swept along the same path.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [`[Sketch; 1+]`](/docs/kcl-std/types/std-types-Sketch) | The sketch or set of sketches that should be swept in space. | Yes |
| `path` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Helix`](/docs/kcl-std/types/std-types-Helix) | The path to sweep the sketch along. | Yes |
| `sectional` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components. | No |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `relativeTo` | [`string`](/docs/kcl-std/types/std-types-string) | What is the sweep relative to? Can be either 'sketchPlane' or 'trajectoryCurve'. | No |
| `tagStart` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the start of the sweep, i.e. the original sketch. | No |
| `tagEnd` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the end of the sweep. | No |

### Returns

[`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid)


### Examples

```kcl
// Create a pipe using a sweep.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

// Create a hole for the pipe.
pipeHole = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.5)

sweepSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> subtract2d(tool = pipeHole)
  |> sweep(path = sweepPath)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Create a spring by sweeping around a helix path.

// Create a helix around the Z axis.
helixPath = helix(
  angleStart = 0,
  ccw = true,
  revolutions = 4,
  length = 10,
  radius = 5,
  axis = Z,
)

// Create a spring by sweeping around the helix path.
springSketch = startSketchOn(XZ)
  |> circle(center = [5, 0], radius = 1)
  |> sweep(path = helixPath)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sweep two sketches along the same path.


sketch001 = startSketchOn(XY)
rectangleSketch = startProfile(sketch001, at = [-200, 23.86])
  |> angledLine(angle = 0, length = 73.47, tag = $rectangleSegmentA001)
  |> angledLine(angle = segAng(rectangleSegmentA001) - 90deg, length = 50.61)
  |> angledLine(angle = segAng(rectangleSegmentA001), length = -segLen(rectangleSegmentA001))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch = circle(sketch001, center = [200, -30.29], radius = 32.63)

sketch002 = startSketchOn(YZ)
sweepPath = startProfile(sketch002, at = [0, 0])
  |> yLine(length = 231.81)
  |> tangentialArc(radius = 80, angle = -90deg)
  |> xLine(length = 384.93)

sweep([rectangleSketch, circleSketch], path = sweepPath)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sectionally sweep one sketch along the path


sketch001 = startSketchOn(XY)
circleSketch = circle(sketch001, center = [200, -30.29], radius = 32.63)

sketch002 = startSketchOn(YZ)
sweepPath = startProfile(sketch002, at = [0, 0])
  |> yLine(length = 231.81)
  |> tangentialArc(radius = 80, angle = -90deg)
  |> xLine(length = 384.93)

sweep(circleSketch, path = sweepPath, sectional = true)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


