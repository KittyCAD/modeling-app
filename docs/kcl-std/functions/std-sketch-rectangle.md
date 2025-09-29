---
title: "rectangle"
subtitle: "Function in std::sketch"
excerpt: "Sketch a rectangle."
layout: manual
---

Sketch a rectangle.

```kcl
rectangle(
  @sketchOrSurface: Sketch | Plane | Face,
  width: number(Length),
  height: number(Length),
  center?: Point2d,
  corner?: Point2d,
): Sketch
```

A rectangle can be defined by its width, height, and location. Either the center or corner must be provided, but not both, to specify its location.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | Sketch to extend, or plane or surface to sketch on. | Yes |
| `width` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Rectangle's width along X axis. | Yes |
| `height` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Rectangle's height along Y axis. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the rectangle. Either `corner` or `center` is required, but not both. | No |
| `corner` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The corner of the rectangle. Either `corner` or `center` is required, but not both. This will be the corner which is most negative on both X and Y axes. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(-XZ)
  |> rectangle(center = [0, 0], width = 10, height = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rectangle function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-rectangle0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-rectangle0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(-XZ)
  |> rectangle(corner = [0, 0], width = 10, height = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rectangle function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-rectangle1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-rectangle1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


