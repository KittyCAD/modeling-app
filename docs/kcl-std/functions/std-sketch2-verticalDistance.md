---
title: "sketch2::verticalDistance"
subtitle: "Function in std::sketch2"
excerpt: "Constrain the vertical distance between two points."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain the vertical distance between two points.

```kcl
sketch2::verticalDistance(@points: [Segment | Point2d; 2])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [[`Segment`](/docs/kcl-std/types/std-types-Segment) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d); 2] | Two sketch points, or one sketch point and `ORIGIN`, whose Y-axis separation should match the value set with `==`. | Yes |


### Examples

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  edge2 = line(start = [var 4mm, var 0mm], end = [var 4mm, var 5mm])
  edge3 = line(start = [var 4mm, var 5mm], end = [var 0mm, var 5mm])
  edge4 = line(start = [var 0mm, var 5mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  verticalDistance([edge1.start, edge4.start]) == 5mm
}

solid = extrude(region(point = [2mm, 2mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sketch2::verticalDistance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch2-verticalDistance0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch2-verticalDistance0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


