---
title: "circleThreePoint"
subtitle: "Function in std::sketch"
excerpt: "Construct a circle derived from 3 points."
layout: manual
---

Construct a circle derived from 3 points.

```kcl
circleThreePoint(
  @sketchOrSurface: Sketch | Plane | Face,
  p1: Point2d,
  p2: Point2d,
  p3: Point2d,
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchOrSurface` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face) | Plane or surface to sketch on. | Yes |
| `p1` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | 1st point to derive the circle. | Yes |
| `p2` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | 2nd point to derive the circle. | Yes |
| `p3` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | 3rd point to derive the circle. | Yes |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Identifier for the circle to reference elsewhere. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XY)
  |> circleThreePoint(p1 = [10, 10], p2 = [20, 8], p3 = [15, 5])
  |> extrude(length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the circleThreePoint function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-circleThreePoint0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-circleThreePoint0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


