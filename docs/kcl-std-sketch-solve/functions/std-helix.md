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
| `revolutions` | `number(_)` | Number of revolutions. | Yes |
| `angleStart` | `number(Angle)` | Start angle. | Yes |
| `ccw` | `bool` | Is the helix rotation counter clockwise? The default is `false`. | No |
| `radius` | `number(Length)` | Radius of the helix. | No |
| `axis` | `Axis3d | Edge | Segment` | Axis to use for the helix. The center of the helix's base will be at this axis's origin point. | No |
| `length` | `number(Length)` | Length of the helix. This is not necessary if the helix is created around an edge. If not given the length of the edge is used. | No |
| `cylinder` | `Solid` | Cylinder to create the helix on. | No |

### Returns

`Helix` - A helix.


### Examples

```kcl
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


