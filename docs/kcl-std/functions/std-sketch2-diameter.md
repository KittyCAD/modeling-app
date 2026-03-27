---
title: "sketch2::diameter"
subtitle: "Function in std::sketch2"
excerpt: "Constrain the diameter of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point. Note: Diameter uses the same solver constraint as radius (distance between two points), but is stored as a separate constraint type for proper UI display."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain the diameter of an arc or circle segment. Accepts a single arc or circle segment and constrains the distance from its center to its start point. Note: Diameter uses the same solver constraint as radius (distance between two points), but is stored as a separate constraint type for proper UI display.

```kcl
sketch2::diameter(@points: Segment)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The arc or circle segment whose diameter should match the value set with `==`. | Yes |


### Examples

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = XY) {
  guide = circle(start = [var 2mm, var 0mm], center = [var 0mm, var 0mm], construction = true)
  diameter(guide) == 4mm
  edge1 = line(start = [var -3mm, var -2mm], end = [var 3mm, var -2mm])
  edge2 = line(start = [var 3mm, var -2mm], end = [var 3mm, var 2mm])
  edge3 = line(start = [var 3mm, var 2mm], end = [var -3mm, var 2mm])
  edge4 = line(start = [var -3mm, var 2mm], end = [var -3mm, var -2mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}

solid = extrude(region(point = [0mm, 0mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sketch2::diameter function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch2-diameter0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch2-diameter0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


