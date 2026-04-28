---
title: "polygon"
subtitle: "Function in std::sketch"
excerpt: "Create a regular polygon with the specified number of sides that is either inscribed or circumscribed around a circle of the specified radius."
layout: manual
---

Create a regular polygon with the specified number of sides that is either inscribed or circumscribed around a circle of the specified radius.

```kcl
polygon(
  @sketchOrSurface: Sketch | Plane | Face,
  radius: number(Length),
  numSides: number(_),
  center?: Point2d,
  inscribed?: bool,
): Sketch
```

This is part of sketch v1 and is soft deprecated in favor of
sketch-solve.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | `Sketch | Plane | Face` | Plane or surface to sketch on. | Yes |
| `radius` | `number(Length)` | The radius of the polygon. | Yes |
| `numSides` | `number(_)` | The number of sides in the polygon. | Yes |
| `center` | `Point2d` | The center point of the polygon. If not given, defaults to `[0, 0]`. | No |
| `inscribed` | `bool` | Whether the polygon is inscribed (true, the default) or circumscribed (false) about a circle with the specified radius. | No |

### Returns

`Sketch` - A sketch is a collection of paths.


### Examples

```kcl
// Create a regular hexagon inscribed in a circle of radius 10
hex = startSketchOn(XY)
  |> polygon(
       radius = 10,
       numSides = 6,
       center = [0, 0],
       inscribed = true,
     )

example = extrude(hex, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the polygon function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-polygon0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-polygon0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Create a square circumscribed around a circle of radius 5
square = startSketchOn(XY)
  |> polygon(
       radius = 5.0,
       numSides = 4,
       center = [10, 10],
       inscribed = false,
     )
example = extrude(square, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the polygon function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-polygon1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-polygon1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


