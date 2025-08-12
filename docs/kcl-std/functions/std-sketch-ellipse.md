---
title: "ellipse"
subtitle: "Function in std::sketch"
excerpt: "Construct a 2-dimensional ellipse, of the specified major/minor radius, centered at the provided (x, y) point."
layout: manual
---

Construct a 2-dimensional ellipse, of the specified major/minor radius, centered at the provided (x, y) point.

```kcl
ellipse(
  @sketchOrSurface: Sketch | Plane | Face,
  center: Point2d,
  minorRadius: number(Length),
  majorRadius?: number(Length),
  majorAxis?: Point2d,
  tag?: tag,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | Sketch to extend, or plane or surface to sketch on. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the ellipse. | Yes |
| `minorRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The minor radius of the ellipse. | Yes |
| `majorRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The major radius of the ellipse. Equivalent to majorAxis = [majorRadius, 0]. | No |
| `majorAxis` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The major axis of the ellipse. | No |
| `tag` | `tag` | Create a new tag which refers to this ellipse. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XY)
  |> ellipse(center = [0, 0], majorRadius = 50, minorRadius = 20)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-ellipse0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-ellipse0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


