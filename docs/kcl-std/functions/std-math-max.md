---
title: "max"
subtitle: "Function in std::math"
excerpt: "Compute the maximum of the given arguments."
layout: manual
---

Compute the maximum of the given arguments.

```kcl
max(@input: [number; 1+]): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`number`](/docs/kcl-std/types/std-types-number); 1+] | An array of numbers to compute the maximum of. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 70deg, length = max([15, 31, 4, 13, 22]))
  |> line(end = [20, 0])
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the max function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-max0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-max0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


