---
title: "startOf"
subtitle: "Function in std"
excerpt: "Return the start endpoint of an edge. This is useful for dimension and GD&T annotations that need to anchor to a specific end of an edge without referring to a BREP vertex index."
layout: manual
---

Return the start endpoint of an edge. This is useful for dimension and GD&T annotations that need to anchor to a specific end of an edge without referring to a BREP vertex index.

```kcl
startOf(@edge: Edge): EdgeEndpoint
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `edge` | [`Edge`](/docs/kcl-std/types/std-types-Edge) | Edge whose start endpoint should be referenced. | Yes |

### Returns

[`EdgeEndpoint`](/docs/kcl-std/types/std-types-EdgeEndpoint) - The start or end endpoint of an edge.


### Examples

```kcl
cube = startSketchOn(XY)
  |> rectangle(width = 10, height = 10, center = [0, 0])
  |> extrude(length = 2)

topEdge = edgeId(cube, closestTo = [0, 5, 2])
gdt::distance(from = startOf(topEdge), to = endOf(topEdge), tolerance = 0.1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startOf function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-startOf0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-startOf0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>
