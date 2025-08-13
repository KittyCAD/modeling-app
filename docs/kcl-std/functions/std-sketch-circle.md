---
title: "circle"
subtitle: "Function in std::sketch"
excerpt: "Construct a 2-dimensional circle, of the specified radius, centered at the provided (x, y) origin point."
layout: manual
---

Construct a 2-dimensional circle, of the specified radius, centered at the provided (x, y) origin point.

```kcl
circle(
  @sketchOrSurface: Sketch | Plane | Face,
  center: Point2d,
  radius?: number(Length),
  diameter?: number(Length),
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | Sketch to extend, or plane or surface to sketch on. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the circle. | Yes |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The radius of the circle. Incompatible with `diameter`. | No |
| `diameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The diameter of the circle. Incompatible with `radius`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this circle. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(-XZ)
  |> circle(center = [0, 0], radius = 10)

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-circle0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-circle0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [-15, 0])
  |> line(end = [30, 0])
  |> line(end = [0, 30])
  |> line(end = [-30, 0])
  |> close()
  |> subtract2d(tool = circle(center = [0, 15], diameter = 10))

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-circle1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-circle1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


