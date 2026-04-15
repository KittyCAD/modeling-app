---
title: "deleteFace"
subtitle: "Function in std::solid"
excerpt: "Delete a face from a body (a solid, or a polysurface)."
layout: manual
---

Delete a face from a body (a solid, or a polysurface).

```kcl
deleteFace(
  @body: Solid,
  faces?: [TaggedFace; 1+],
  faceIndices?: [number(_); 1+],
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | `Solid` | Target to delete a surface from. | Yes |
| `faces` | `[TaggedFace; 1+]` | Face to delete. This is the usual face representation, e.g. a tagged face. | No |
| `faceIndices` | `[number(_); 1+]` | Face to delete. The index is a stable ordering of faces, used when you can't get the usual ID (UUID) of a face. | No |

### Returns

`Solid` - A solid is a collection of extruded surfaces.


### Examples

```kcl
boxProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  edge2 = line(start = [var 5mm, var 0mm], end = [var 5mm, var 5mm])
  edge3 = line(start = [var 5mm, var 5mm], end = [var 0mm, var 5mm])
  edge4 = line(start = [var 0mm, var 5mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

box = extrude(region(point = [2mm, 2mm], sketch = boxProfile), length = 4mm, tagEnd = $top)
openBox = deleteFace(box, faces = [top])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the deleteFace function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-deleteFace3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-deleteFace3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


