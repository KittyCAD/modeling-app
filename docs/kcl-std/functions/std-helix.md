---
title: "helix"
subtitle: "Function in std"
excerpt: "Create a helix."
layout: manual
---

Create a helix.

```kcl
helix(
  revolutions: number(_),
  angleStart: number(Angle),
  ccw?: bool,
  radius?: number(Length),
  axis?: Axis3d | Edge | Segment,
  length?: number(Length),
  cylinder?: Solid,
): Helix
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `revolutions` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Number of revolutions. | Yes |
| `angleStart` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Start angle. | Yes |
| `ccw` | [`bool`](/docs/kcl-std/types/std-types-bool) | Is the helix rotation counter clockwise? The default is `false`. | No |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Radius of the helix. | No |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | Axis to use for the helix. The center of the helix's base will be at this axis's origin point. | No |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Length of the helix. This is not necessary if the helix is created around an edge. If not given the length of the edge is used. | No |
| `cylinder` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Cylinder to create the helix on. | No |

### Returns

[`Helix`](/docs/kcl-std/types/std-types-Helix) - A helix.


### Examples

```kcl
// Create a helix around the Z axis.
helixPath = helix(
  angleStart = 0,
  ccw = true,
  revolutions = 5,
  length = 10,
  radius = 5,
  axis = Z,
)

// Create a spring by sweeping around the helix path.
springSketch = startSketchOn(XZ)
  |> circle(center = [5, 0], radius = 0.5)
  |> sweep(path = helixPath)

```


![Rendered example of helix 0](/kcl-test-outputs/serial_test_example_fn_std-helix0.png)

```kcl
// Create a helix around an edge.
helper001 = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 10], tag = $edge001)

helixPath = helix(
  angleStart = 0,
  ccw = true,
  revolutions = 5,
  length = 10,
  radius = 5,
  axis = edge001,
)

// Create a spring by sweeping around the helix path.
springSketch = startSketchOn(XZ)
  |> circle(center = [5, 0], radius = 0.5)
  |> sweep(path = helixPath)

```


![Rendered example of helix 1](/kcl-test-outputs/serial_test_example_fn_std-helix1.png)

```kcl
// Create a helix around a custom axis.
helixPath = helix(
  angleStart = 0,
  ccw = true,
  revolutions = 5,
  length = 10,
  radius = 5,
  axis = {
    direction = [0, 0, 1.0],
    origin = [0, 0.25, 0]
  },
)

// Create a spring by sweeping around the helix path.
springSketch = startSketchOn(XZ)
  |> circle(center = [5, 0], radius = 1)
  |> sweep(path = helixPath)

```


![Rendered example of helix 2](/kcl-test-outputs/serial_test_example_fn_std-helix2.png)

```kcl
// Create a helix on a cylinder.

part001 = startSketchOn(XY)
  |> circle(center = [5, 5], radius = 10)
  |> extrude(length = 10)

helix(
  angleStart = 0,
  ccw = true,
  revolutions = 16,
  cylinder = part001,
)

```


![Rendered example of helix 3](/kcl-test-outputs/serial_test_example_fn_std-helix3.png)

```kcl
@settings(experimentalFeatures = allow)

// Demonstrate building a helix where the central axis is a line defined in a sketch block.
// First, here's the sketch block with a line:
sketch002 = sketch(on = XZ) {
  line1 = line(start = [var -0.82mm, var 3.4mm], end = [var -1.58mm, var -5.24mm])
}

// Create a helix around the line in the sketch above.
helixPath = helix(
  angleStart = 0,
  ccw = true,
  revolutions = 5,
  length = 10,
  radius = 5,
  axis = sketch002.line1,
)

// Create a spring by sweeping around the helix path.
springSketch = startSketchOn(XZ)
  |> circle(center = [5, 0], radius = 0.5)
  |> sweep(path = helixPath)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the helix function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-helix4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-helix4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


