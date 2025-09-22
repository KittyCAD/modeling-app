---
title: "getCommonEdge"
subtitle: "Function in std::sketch"
excerpt: "Get the shared edge between two faces."
layout: manual
---

Get the shared edge between two faces.

```kcl
getCommonEdge(faces: [TaggedFace; 2]): Edge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `faces` | `[TaggedFace; 2]` | The tags of the faces you want to find the common edge between. | Yes |

### Returns

[`Edge`](/docs/kcl-std/types/std-types-Edge) - An edge of a solid.


### Examples

```kcl
// Get an edge shared between two faces, created after a chamfer.


scale = 20
part001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, scale])
  |> line(end = [scale, 0])
  |> line(end = [0, -scale])
  |> close(tag = $line0)
  |> extrude(length = 20, tagEnd = $end0)
  // We tag the chamfer to reference it later.
  |> chamfer(length = 10, tags = [getOppositeEdge(line0)], tag = $chamfer0)

// Get the shared edge between the chamfer and the extrusion.
commonEdge = getCommonEdge(faces = [chamfer0, end0])

// Chamfer the shared edge.
// TODO: uncomment this when ssi for fillets lands
// chamfer(part001, length = 5, tags = [commonEdge])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the getCommonEdge function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-getCommonEdge0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-getCommonEdge0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


