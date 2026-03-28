---
title: "hole::holesLinear"
subtitle: "Function in std::hole"
excerpt: "Place the given holes in a line. Basically like function `hole` but cuts multiple holes in a line. Works like linear patterns."
layout: manual
---

Place the given holes in a line. Basically like function `hole` but cuts multiple holes in a line. Works like linear patterns.

```kcl
hole::holesLinear(
  @solid: Solid,
  face: TaggedFace,
  holeBottom,
  holeBody,
  holeType,
  cutAt: [number(Length); 2],
  instances: number(_),
  distance,
  axis: Axis3d | Point3d,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Which solid to add a hole to. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Which face of the solid to add the hole to. Controls the orientation of the hole. | Yes |
| `holeBottom` |  | Define bottom feature of the hole. E.g. drilled or flat. | Yes |
| `holeBody` |  | Define the main length of the hole. E.g. a blind distance. | Yes |
| `holeType` |  | Define the top feature of the hole. E.g. countersink, counterbore, simple. | Yes |
| `cutAt` | [[`number(Length)`](/docs/kcl-std/types/std-types-number); 2] | Where to place the first cut in the linear pattern, given as absolute coordinates in the global scene. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | How many holes to cut. | Yes |
| `distance` |  | How far between each hole | Yes |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | Along which 3D axis should the holes be patterned? | Yes |


### Examples

```kcl
@settings(experimentalFeatures = allow)

blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 12mm, var 0mm])
  edge2 = line(start = [var 12mm, var 0mm], end = [var 12mm, var 6mm])
  edge3 = line(start = [var 12mm, var 6mm], end = [var 0mm, var 6mm])
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

block = extrude(region(point = [6mm, 3mm], sketch = blockProfile), length = 5mm, tagEnd = $top)
drilledBlock = hole::holesLinear(
  block,
  face = top,
  cutAt = [2mm, 3mm],
  instances = 4,
  distance = 2.5mm,
  axis = X,
  holeBottom = hole::flat(),
  holeBody = hole::blind(depth = 3mm, diameter = 1.5mm),
  holeType = hole::simple(),
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::holesLinear function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-holesLinear0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-holesLinear0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


