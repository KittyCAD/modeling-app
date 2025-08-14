---
title: "segEndX"
subtitle: "Function in std::sketch"
excerpt: "Compute the ending point of the provided line segment along the 'x' axis."
layout: manual
---

Compute the ending point of the provided line segment along the 'x' axis.

```kcl
segEndX(@tag: TaggedEdge): number(Length)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The line segment being queried by its tag. | Yes |

### Returns

[`number(Length)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [20, 0], tag = $thing)
  |> line(end = [0, 5])
  |> line(end = [segEndX(thing), 0])
  |> line(end = [-20, 10])
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-segEndX0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-segEndX0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


