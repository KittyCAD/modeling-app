---
title: "bezierCurve"
subtitle: "Function in std::sketch"
excerpt: "Draw a smooth, continuous, curved line segment from the current origin to the desired (x, y), using a number of control points to shape the curve's shape."
layout: manual
---

Draw a smooth, continuous, curved line segment from the current origin to the desired (x, y), using a number of control points to shape the curve's shape.

```kcl
bezierCurve(
  @sketch: Sketch,
  control1?: Point2d,
  control2?: Point2d,
  end?: Point2d,
  control1Absolute?: Point2d,
  control2Absolute?: Point2d,
  endAbsolute?: Point2d,
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `control1` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | First control point for the cubic. | No |
| `control2` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Second control point for the cubic. | No |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | How far away (along the X and Y axes) should this line go? | No |
| `control1Absolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | First control point for the cubic. Absolute point. | No |
| `control2Absolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Second control point for the cubic. Absolute point. | No |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Coordinate on the plane at which this line should end. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
// Example using relative control points.
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 10])
  |> bezierCurve(control1 = [5, 0], control2 = [5, 10], end = [10, 10])
  |> line(endAbsolute = [10, 0])
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the bezierCurve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-bezierCurve0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-bezierCurve0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Example using absolute control points.
startSketchOn(XY)
  |> startProfile(at = [300, 300])
  |> bezierCurve(control1Absolute = [600, 300], control2Absolute = [-300, -100], endAbsolute = [600, 600])
  |> close()
  |> extrude(length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the bezierCurve function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-bezierCurve1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-bezierCurve1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


