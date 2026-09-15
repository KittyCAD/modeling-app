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

Both face references must refer to the same underlying geometry and share an
edge. The geometry recorded in the tags must match; touching faces or a shared
sketch origin are not enough. Do not mix references from a body and its clone
or mirror. A geometry mismatch produces the error `getCommonEdge requires the
faces to be in the same original sketch`.

After a Boolean operation, carried face tags can still refer to consumed source
bodies, even when accessed through the result's `faces`. Unioning separately
constructed parts does not make their original face tags valid for selecting
the new junction with `getCommonEdge`.

For a simple L-shaped junction, one supported approach is to extrude a single
profile, then fillet the edge between its two inner side faces:

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 2] | The tags of the faces you want to find the common edge between. | Yes |

### Returns

[`Edge`](/docs/kcl-std/types/std-types-Edge) - An edge of a solid.


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

partSketch = sketch(on = XY) {
  bottom = line(start = [0mm, 0mm], end = [20mm, 0mm])
  right = line(start = [20mm, 0mm], end = [20mm, 5mm])
  innerHorizontal = line(start = [20mm, 5mm], end = [5mm, 5mm])
  innerVertical = line(start = [5mm, 5mm], end = [5mm, 20mm])
  top = line(start = [5mm, 20mm], end = [0mm, 20mm])
  left = line(start = [0mm, 20mm], end = [0mm, 0mm])
}
partRegion = region(segments = [partSketch.bottom])
part = extrude(partRegion, length = 10mm)
// Both tags belong to this one extruded profile. Original tags from separate
// parts cannot select a new junction after union.
commonEdge = getCommonEdge(faces = [
  partRegion.tags.innerHorizontal,
  partRegion.tags.innerVertical
])
roundedPart = fillet(part, radius = 2mm, tags = [commonEdge])

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


