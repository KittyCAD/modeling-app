---
title: "gdt::name"
subtitle: "Function in std::gdt"
excerpt: "Set a name of a face or edge. The name will be used in exported STEP files for use in downstream tools."
layout: manual
---

Set a name of a face or edge. The name will be used in exported STEP files for use in downstream tools.

```kcl
gdt::name(
  name: string,
  face?: Face | TaggedFace,
  edge?: Edge | TaggedEdge,
)
```

Exactly one of `face` or `edge` must be provided. Specifying both is an
error.

The same face or edge can be named more than once; the last name wins.
Passing an empty `name` clears any name previously assigned to that face
or edge.

Names may contain only non-control ASCII characters. Spaces are allowed, but
other whitespace characters like newline are considered control characters,
which are disallowed. Single-quote characters are also disallowed. The
maximum length is 1024 characters.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `name` | [`string`](/docs/kcl-std/types/std-types-string) | The name to assign. ASCII characters besides control characters and single-quotes are allowed, with a maximum length of 1024. An empty string clears any previously assigned name. | Yes |
| `face` | [`Face`](/docs/kcl-std/types/std-types-Face) or [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | The face to name. Cannot be combined with `edge`. | No |
| `edge` | [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The edge to name. Cannot be combined with `face`. | No |


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

boxRegion = region(point = [2mm, 2mm], sketch = boxProfile)
box = extrude(boxRegion, length = 4mm, tagEnd = $top)
gdt::name(face = top, name = "mounting-face")
gdt::name(edge = getCommonEdge(faces = [boxRegion.tags.edge1, top]), name = "front_top_edge")

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gdt::name function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gdt-name0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gdt-name0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


