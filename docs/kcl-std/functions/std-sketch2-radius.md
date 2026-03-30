---
title: "sketch2::radius"
subtitle: "Function in std::sketch2"
excerpt: "Constrain the radius of an arc segment. Accepts a single arc segment and constrains the distance from its center to its start point."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain the radius of an arc segment. Accepts a single arc segment and constrains the distance from its center to its start point.

```kcl
sketch2::radius(@points: Segment)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The arc segment whose radius should match the value set with `==`. | Yes |


### Examples

```kcl
@settings(experimentalFeatures = allow)

profile = sketch(on = XY) {
  base = line(start = [var -4mm, var 0mm], end = [var 4mm, var 0mm])
  arch = arc(start = [var 4mm, var 0mm], end = [var -4mm, var 0mm], center = [var 0mm, var 0mm])
  coincident([base.end, arch.start])
  coincident([base.start, arch.end])
  radius(arch) == 4mm
}

solid = extrude(region(point = [0mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sketch2::radius function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch2-radius0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch2-radius0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


