---
title: "sweep"
subtitle: "Function in std::sketch"
excerpt: "Create a 3D surface or solid by sweeping a sketch along a path."
layout: manual
---

Create a 3D surface or solid by sweeping a sketch along a path.

```kcl
sweep(
  @sketches: [Sketch | Segment; 1+],
  path: Sketch | Helix | [Segment; 1+],
  sectional?: bool,
  tolerance?: number(Length),
  relativeTo?: string,
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  bodyType?: string,
  version?: number(_),
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
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | The sketch or set of sketches that should be swept in space. | Yes |
| `path` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Helix`](/docs/kcl-std/types/std-types-Helix) or [[`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | The path to sweep the sketch along. | Yes |
| `sectional` | [`bool`](/docs/kcl-std/types/std-types-bool) | If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components. | No |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `relativeTo` | [`string`](/docs/kcl-std/types/std-types-string) | What is the sweep relative to? Can be either 'sketchPlane' or 'trajectoryCurve'. | No |
| `tagStart` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the start of the sweep, i.e. the original sketch. | No |
| `tagEnd` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the end of the sweep. | No |
| `bodyType` | [`string`](/docs/kcl-std/types/std-types-string) | What type of body to produce (solid or surface). Defaults to "solid". | No |
| `version` | [`number(_)`](/docs/kcl-std/types/std-types-number) | What version of the sweeping algorithm to use (leave unspecified or use 0 to use the default algorithm). | No |

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

```kcl
// Sweep a segment along a path
segment = startSketchOn(YZ)
  |> startProfile(at = [-100, 200])
  |> line(end = [100, 0])

path = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [100, 0])
  |> tangentialArc(end = [117, 34.5])

sweep(
  segment,
  path,
  bodyType = SURFACE,
  version = 2,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = YZ) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 2mm, var 0mm])
  edge2 = line(start = [var 2mm, var 0mm], end = [var 2mm, var 2mm])
  edge3 = line(start = [var 2mm, var 2mm], end = [var 0mm, var 2mm])
  edge4 = line(start = [var 0mm, var 2mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}

profileRegion = region(point = [1mm, 1mm], sketch = profile)

path = startSketchOn(XY)
  |> startProfile(at = [0mm, 0mm])
  |> line(end = [8mm, 0mm])
  |> tangentialArc(end = [4mm, 4mm])

swept = sweep(profileRegion, path)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

// Demonstrates using sweeps with segments from sketch blocks.

// Sketch a square
sketch001 = sketch(on = XZ) {
  line1 = line(start = [var -3.34mm, var -1.89mm], end = [var -1.62mm, var -1.89mm])
  line2 = line(start = [var -1.62mm, var -1.89mm], end = [var -1.62mm, var 0.56mm])
  line3 = line(start = [var -1.62mm, var 0.56mm], end = [var -3.34mm, var 0.56mm])
  line4 = line(start = [var -3.34mm, var 0.56mm], end = [var -3.34mm, var -1.89mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}

// Sketch a path
sketch002 = sketch(on = offsetPlane(YZ, offset = -2)) {
  line1 = line(start = [var 00mm, var 0mm], end = [var -3mm, var 0mm])
  line2 = line(start = [var 00mm, var 0mm], end = [var 2mm, var 1mm])
}

mySquare = region(point = [-2.48mm, -1.8875mm], sketch = sketch001)

// Sweep the square along the path.
sweep(mySquare, path = sketch002.line1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep8_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep8.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Demonstrates sweeping along a multi-segment path from a sketch block.
@settings(experimentalFeatures = allow)

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 2mm, var 2mm], end = [var 2mm, var 0mm])
  line2 = line(start = [var 2mm, var 0mm], end = [var 0mm, var 0mm])
  line3 = line(start = [var 0mm, var 0mm], end = [var 0mm, var 2mm])
  line4 = line(start = [var 0mm, var 2mm], end = [var 2mm, var 2mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
}
mySquare = region(point = [1.9975mm, 1mm], sketch = sketch001)

// Sketch a path
sketch002 = sketch(on = offsetPlane(YZ, offset = -2)) {
  line1 = line(start = [var -0.01mm, var -0.01mm], end = [var -0.12mm, var 2.4mm])
  arc1 = arc(start = [var 0.6mm, var 4.55mm], end = [var -0.12mm, var 2.4mm], center = [var 3.03mm, var 2.54mm])
  coincident([line1.end, arc1.end])
  tangent([line1, arc1])
}

// Sweep the square along the path.
path = [sketch002.line1, sketch002.arc1]
sweep(mySquare, path)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep9_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep9.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

// Demonstrates surface sweeps of open profiles.

// Sketch a square
sketch001 = sketch(on = XY) {
  line1 = line(start = [var -3.34mm, var -1.89mm], end = [var -1.62mm, var -1.89mm])
  line2 = line(start = [var -1.62mm, var -1.89mm], end = [var -1.62mm, var 0.56mm])
  line3 = line(start = [var -1.62mm, var 0.56mm], end = [var -3.34mm, var 0.56mm])
  line4 = line(start = [var -3.34mm, var 0.56mm], end = [var -3.34mm, var -1.89mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}

mySquare = region(point = [-2.48mm, -1.8875mm], sketch = sketch001)

sketch002 = sketch(on = XZ) {
  line1 = line(start = [var -1.17mm, var -0.79mm], end = [var -15.37mm, var -0.7mm])
  arc1 = arc(start = [var -15.37mm, var 21.18mm], end = [var -15.37mm, var -0.7mm], center = [var -15.3mm, var 10.24mm])
  coincident([line1.end, arc1.end])
  tangent([line1, arc1])
}

// Sweep the square along the path.
path = [sketch002.line1, sketch002.arc1]
sweep(sketch001.line2, path, bodyType = SURFACE)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sweep function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-sweep10_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-sweep10.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


