---
title: "segAng"
subtitle: "Function in std::sketch"
excerpt: "Compute the angle (in degrees) of the provided line segment."
layout: manual
---

Compute the angle (in degrees) of the provided line segment.

```kcl
segAng(@tag: TaggedEdge): number(Angle)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The line segment being queried by its tag. | Yes |

### Returns

[`number(Angle)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [5, 10], tag = $seg01)
  |> line(end = [-10, 0])
  |> angledLine(angle = segAng(seg01), length = 10)
  |> line(end = [-10, 0])
  |> angledLine(angle = segAng(seg01), length = -15)
  |> close()

example = extrude(exampleSketch, length = 4)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-segAng0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-segAng0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


