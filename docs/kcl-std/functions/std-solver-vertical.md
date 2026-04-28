---
title: "solver::vertical"
subtitle: "Function in std::solver"
excerpt: "Constrain a line, or a list of points, to be vertical."
layout: manual
---

Constrain a line, or a list of points, to be vertical.

```kcl
solver::vertical(@input: Segment | [Segment | Point2d; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [`Segment`](/docs/kcl-std/types/std-types-Segment) or [[`Segment`](/docs/kcl-std/types/std-types-Segment) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d); 2+] | Either - A single line segment that should remain vertical. - A list of points which should all be vertical. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 4mm, var 0mm])
  edge2 = line(start = [var 4mm, var 0mm], end = [var 4mm, var 3mm])
  edge3 = line(start = [var 4mm, var 3mm], end = [var 0mm, var 3mm])
  edge4 = line(start = [var 0mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  vertical(edge2)
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::vertical function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-vertical0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-vertical0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
profile = sketch(on = XY) {
  p0 = [var 0mm, var 0mm]
  p1 = [var 4mm, var 0mm]
  vertical([p0, p1])
}

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::vertical function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-vertical1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-vertical1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sketch001 = sketch(on = XY) {
  p0 = point(at = [var 2.1mm, var -0.03mm])
  vertical([p0, ORIGIN])
}

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::vertical function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-vertical2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-vertical2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


