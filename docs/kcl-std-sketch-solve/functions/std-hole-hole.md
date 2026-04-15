---
title: "hole::hole"
subtitle: "Function in std::hole"
excerpt: "From the hole's parts (bottom, middle, top), cut the hole into the given solid, at the given 2D position on the given face."
layout: manual
---

From the hole's parts (bottom, middle, top), cut the hole into the given solid, at the given 2D position on the given face.

```kcl
hole::hole(
  @solid: Solid,
  face: TaggedFace,
  holeBottom,
  holeBody,
  holeType,
  cutAt: [number(Length); 2],
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | `Solid` | Which solid to add a hole to. | Yes |
| `face` | `TaggedFace` | Which face of the solid to add the hole to. Controls the orientation of the hole. | Yes |
| `holeBottom` |  | Define bottom feature of the hole. E.g. drilled or flat. | Yes |
| `holeBody` |  | Define the main length of the hole. E.g. a blind distance. | Yes |
| `holeType` |  | Define the top feature of the hole. E.g. countersink, counterbore, simple. | Yes |
| `cutAt` | `[number(Length); 2]` | Where to place the cut on the given face of the solid. Given as absolute coordinates in the global scene. | Yes |


### Examples

```kcl
blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 8mm, var 0mm])
  edge2 = line(start = [var 8mm, var 0mm], end = [var 8mm, var 6mm])
  edge3 = line(start = [var 8mm, var 6mm], end = [var 0mm, var 6mm])
  edge4 = line(start = [var 0mm, var 6mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

block = extrude(region(point = [4mm, 3mm], sketch = blockProfile), length = 6mm, tagEnd = $top)
drilledBlock = hole::hole(
  block,
  face = top,
  cutAt = [4mm, 3mm],
  holeBottom = hole::flat(),
  holeBody = hole::blind(depth = 4mm, diameter = 2mm),
  holeType = hole::simple(),
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::hole function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-hole2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-hole2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


