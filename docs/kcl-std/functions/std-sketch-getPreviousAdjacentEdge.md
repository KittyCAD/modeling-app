---
title: "getPreviousAdjacentEdge"
subtitle: "Function in std::sketch"
excerpt: "Get the previous adjacent edge to the edge given."
layout: manual
---

Get the previous adjacent edge to the edge given.

```kcl
getPreviousAdjacentEdge(@edge: TaggedEdge): Edge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `edge` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The tag of the edge you want to find the previous adjacent edge of. | Yes |

### Returns

[`Edge`](/docs/kcl-std/types/std-types-Edge) - An edge of a solid.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> angledLine(angle = 60deg, length = 10)
  |> angledLine(angle = 120deg, length = 10)
  |> line(end = [-10, 0])
  |> angledLine(angle = 240deg, length = 10, tag = $referenceEdge)
  |> close()

example = extrude(exampleSketch, length = 5)
  |> fillet(radius = 3, tags = [getPreviousAdjacentEdge(referenceEdge)])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the getPreviousAdjacentEdge function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-getPreviousAdjacentEdge0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-getPreviousAdjacentEdge0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


