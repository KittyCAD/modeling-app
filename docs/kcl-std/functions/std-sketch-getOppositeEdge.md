---
title: "getOppositeEdge"
subtitle: "Function in std::sketch"
excerpt: "Get the opposite edge to the edge given."
layout: manual
---

Get the opposite edge to the edge given.

```kcl
getOppositeEdge(@edge: TaggedEdge): Edge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `edge` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The tag of the edge you want to find the opposite edge of. | Yes |

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
  |> fillet(radius = 3, tags = [getOppositeEdge(referenceEdge)])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-getOppositeEdge0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-getOppositeEdge0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


