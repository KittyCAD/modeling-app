---
title: "lastSegY"
subtitle: "Function in std::sketch"
excerpt: "Extract the 'y' axis value of the last line segment in the provided 2-d sketch."
layout: manual
---

Extract the 'y' axis value of the last line segment in the provided 2-d sketch.

```kcl
lastSegY(@sketch: Sketch): number(Length)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | The sketch whose line segment is being queried. | Yes |

### Returns

[`number(Length)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [5, 0])
  |> line(end = [20, 5])
  |> line(end = [0, lastSegY(%)])
  |> line(end = [-15, 0])
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-lastSegY0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-lastSegY0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


