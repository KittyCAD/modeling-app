---
title: "sweep"
subtitle: "Function in std::sketch"
excerpt: "Create a 3D surface or solid by sweeping a sketch along a path."
layout: manual
---

Create a 3D surface or solid by sweeping a sketch along a path.

```kcl
sweep(
  @sketches: [Sketch; 1+],
  path: Sketch | Helix,
  sectional?: bool,
  tolerance?: number(Length),
  relativeTo?: string,
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  bodyType?: string,
): [Solid; 1+]
```

This, like extrude, is able to create a 3-dimensional surface or solid from a
2-dimensional sketch. However, unlike extrude, this creates a body
by using the extent of the sketch as its path. This is useful for
creating more complex shapes that can't be created with a simple
extrusion.

You can provide more than one sketch to sweep, and they will all be
swept along the same path.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] | The sketch or set of sketches that should be swept in space. | Yes |
| `path` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Helix`](/docs/kcl-std/types/std-types-Helix) | The path to sweep the sketch along. | Yes |
| `sectional` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components. | No |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `relativeTo` | [`string`](/docs/kcl-std/types/std-types-string) | What is the sweep relative to? Can be either 'sketchPlane' or 'trajectoryCurve'. | No |
| `tagStart` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the start of the sweep, i.e. the original sketch. | No |
| `tagEnd` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the end of the sweep. | No |
| `bodyType` | [`string`](/docs/kcl-std/types/std-types-string) | What type of body to produce (solid or surface). Defaults to "solid". | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


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

```kcl
// Sweep a square edge along a path
square = startSketchOn(XY)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> close()

path = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [100, 0])
  |> tangentialArc(end = [107, -48])

sweep(square, path, bodyType = SURFACE)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sweep a segment along a path
segment = startSketchOn(YZ)
  |> startProfile(at = [-100, 200])
  |> line(end = [100, 0])

path = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [100, 0])
  |> tangentialArc(end = [117, 34.5])

sweep(segment, path, bodyType = SURFACE)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


