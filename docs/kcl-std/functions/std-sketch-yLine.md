---
title: "yLine"
subtitle: "Function in std::sketch"
excerpt: "Draw a line relative to the current origin to a specified distance away from the current position along the 'y' axis."
layout: manual
---

Draw a line relative to the current origin to a specified distance away from the current position along the 'y' axis.

```kcl
yLine(
  @sketch: Sketch,
  length?: number(Length),
  endAbsolute?: number(Length),
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | How far away along the Y axis should this line go? Incompatible with `endAbsolute`. | No |
| `endAbsolute` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Which absolute Y value should this line go to? Incompatible with `length`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> yLine(length = 15)
  |> angledLine(angle = 30deg, length = 15)
  |> line(end = [8, -10])
  |> yLine(length = -5)
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-yLine0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-yLine0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


