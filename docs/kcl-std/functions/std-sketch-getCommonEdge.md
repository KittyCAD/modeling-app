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

shaftSketch = sketch(on = XY) {
  shaftCircle = circle(start = [var 4mm, var 0mm], center = [var 0mm, var 0mm])
  radius(shaftCircle) == 4mm
}
shaftRegion = region(segments = [shaftSketch.shaftCircle])
shaft = extrude(shaftRegion, length = 20mm, tagEnd = $shaftTop)

// The circle identifies the cylindrical side face after extrusion.
// Together with the tagged end face, it identifies the top rim.
topRim = getCommonEdge(faces = [
  shaft.sketch.tags.shaftCircle,
  shaft.faces.shaftTop
])

chamfer(shaft, length = 1mm, tags = [topRim])

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


