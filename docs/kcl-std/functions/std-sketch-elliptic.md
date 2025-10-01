---
title: "elliptic"
subtitle: "Function in std::sketch"
excerpt: "Add an elliptic section to an existing sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Add an elliptic section to an existing sketch.

```kcl
elliptic(
  @sketch: Sketch,
  center: Point2d,
  angleStart: number(Angle),
  angleEnd: number(Angle),
  minorRadius: number(Length),
  majorRadius?: number(Length),
  majorAxis?: Point2d,
  tag?: tag,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the ellipse. | Yes |
| `angleStart` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Where along the ellptic should this segment start? | Yes |
| `angleEnd` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Where along the ellptic should this segment end? | Yes |
| `minorRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The minor radius, b, of the elliptic equation x^2 / a^2 + y^2 / b^2 = 1. | Yes |
| `majorRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The major radius, a, of the elliptic equation x^2 / a^2 + y^2 / b^2 = 1. Equivalent to majorAxis = [majorRadius, 0]. | No |
| `majorAxis` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The major axis of the elliptic. | No |
| `tag` | `tag` | Create a new tag which refers to this arc. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
@settings(experimentalFeatures = allow)

majorRadius = 2
minorRadius = 1
ellip = ellipticPoint(majorRadius, minorRadius, x = 2)

exampleSketch = startSketchOn(XY)
  |> startProfile(at = ellip, tag = $start)
  |> elliptic(
       center = [0, 0],
       angleStart = segAng(start),
       angleEnd = 160deg,
       majorRadius,
       minorRadius,
     )
  |> close()
example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the elliptic function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-elliptic0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-elliptic0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


