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
  axis?: Axis3d | Edge,
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
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Edge`](/docs/kcl-std/types/std-types-Edge) | Axis to use for the helix. | No |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Length of the helix. This is not necessary if the helix is created around an edge. If not given the length of the edge is used. | No |
| `cylinder` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Cylinder to create the helix on. | No |

### Returns

[`Helix`](/docs/kcl-std/types/std-types-Helix) - A helix; created by the `helix` function.


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


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-helix0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-helix0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

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


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-helix1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-helix1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

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


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-helix2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-helix2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

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


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-helix3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-helix3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


