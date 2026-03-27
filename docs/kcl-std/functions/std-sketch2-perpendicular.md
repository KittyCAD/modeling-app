---
title: "sketch2::perpendicular"
subtitle: "Function in std::sketch2"
excerpt: "Constrain lines to be perpendicular."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain lines to be perpendicular.

```kcl
sketch2::perpendicular(@input: [Segment; 2+])
```

Currently limited to two lines.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2+] | The line segments that should remain perpendicular. Currently limited to two lines. | Yes |


### Examples

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  edge2 = line(start = [var 4mm, var 0mm], end = [var 4mm, var 3mm])
  edge3 = line(start = [var 4mm, var 3mm], end = [var 0mm, var 3mm])
  edge4 = line(start = [var 0mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  perpendicular([edge1, edge2])
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sketch2::perpendicular function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch2-perpendicular0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch2-perpendicular0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


