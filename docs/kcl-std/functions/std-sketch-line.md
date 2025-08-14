---
title: "line"
subtitle: "Function in std::sketch"
excerpt: "Extend the current sketch with a new straight line."
layout: manual
---

Extend the current sketch with a new straight line.

```kcl
line(
  @sketch: Sketch,
  endAbsolute?: Point2d,
  end?: Point2d,
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Which absolute point should this line go to? Incompatible with `end`. | No |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | How far away (along the X and Y axes) should this line go? Incompatible with `endAbsolute`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
triangle = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  // The END argument means it ends at exactly [10, 0].
  // This is an absolute measurement, it is NOT relative to
  // the start of the sketch.
  |> line(endAbsolute = [10, 0])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [-10, 0], tag = $thirdLineOfTriangle)
  |> close()
  |> extrude(length = 5)

box = startSketchOn(XZ)
  |> startProfile(at = [10, 10])
  // The 'to' argument means move the pen this much.
  // So, [10, 0] is a relative distance away from the current point.
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0], tag = $thirdLineOfBox)
  |> close()
  |> extrude(length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-line0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-line0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


