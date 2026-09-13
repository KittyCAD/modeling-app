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
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 2] | The tags of the faces you want to find the common edge between. | Yes |

### Returns

[`Edge`](/docs/kcl-std/types/std-types-Edge) - An edge of a solid.


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

scale = 20mm
partSketch = sketch(on = XY) {
  left = line(start = [var 0mm, var 0mm], end = [var 0mm, var 20mm])
  top = line(start = [var 0mm, var 20mm], end = [var 20mm, var 20mm])
  right = line(start = [var 20mm, var 20mm], end = [var 20mm, var 0mm])
  line0 = line(start = [var 20mm, var 0mm], end = [var 0mm, var 0mm])
  coincident([left.end, top.start])
  coincident([top.end, right.start])
  coincident([right.end, line0.start])
  coincident([line0.end, left.start])
}
partRegion = region(segments = [partSketch.left, partSketch.top])
part001 = extrude(partRegion, length = scale, tagEnd = $end0)
  |> chamfer(length = 10mm, tags = [getOppositeEdge(partRegion.tags.line0)], tag = $chamfer0)

// Select the edge shared by the chamfer and the extrusion's end face.
commonEdge = getCommonEdge(faces = [
  part001.faces.chamfer0,
  part001.faces.end0
])

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


