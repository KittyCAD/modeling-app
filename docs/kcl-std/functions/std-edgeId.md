---
title: "edgeId"
subtitle: "Function in std"
excerpt: "Given an edge index, find its ID."
layout: manual
---

Given an edge index, find its ID.

```kcl
edgeId(
  @body: Solid,
  index: number(_),
): Edge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose edges we're trying to find | Yes |
| `index` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Edge to identify. The index is a stable ordering of edges, used when you can't get the usual ID of an edge. | Yes |

### Returns

[`Edge`](/docs/kcl-std/types/std-types-Edge) - An edge of a solid.


### Examples

```kcl
// Cylinder
cylinder = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 4.09, tag = $seg01)
  |> extrude(length = 5)
  // Fillet the edge at index 2, i.e. the top edge.
  |> fillet(radius = 1, tags = [edgeId(index = 2)])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the edgeId function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-edgeId0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-edgeId0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


