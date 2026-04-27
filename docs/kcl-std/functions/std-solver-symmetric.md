---
title: "solver::symmetric"
subtitle: "Function in std::solver"
excerpt: "Constrain two points, lines, arcs, or circles to be symmetric across an axis line."
layout: manual
---

Constrain two points, lines, arcs, or circles to be symmetric across an axis line.

```kcl
solver::symmetric(
  @input: [Segment; 2],
  axis: Segment,
)
```

Supported homogeneous input pairs:
- `Point` / `Point`
- `Line` / `Line`
- `CircularArc` / `CircularArc`
- `Circle` / `Circle`

Symmetric `Line`s are at opposite angles (reflected across the axis). Symmetric
`CircularArc`s have equal diameters and centers. Note that the `Symmetric` constraint
does _not_ affect the position (i.e. the start and end points) of Lines or Arcs. To
make their positions symmetric too, add another Symmetric constraint on their start
and endpoints.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] | Exactly two points, lines, arcs, or circles of the same kind. | Yes |
| `axis` | [`Segment`](/docs/kcl-std/types/std-types-Segment) | The line to mirror across. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  left = line(start = [var 0mm, var 0mm], end = [var 0mm, var 4mm])
  right = line(start = [var 4mm, var 0mm], end = [var 4mm, var 4mm])
  axis = line(start = [var 2.26mm, var -1mm], end = [var 2.26mm, var 4.25mm], construction = true)
  symmetric([left, right], axis = axis)
  coincident([left.end, axis.end])
  coincident([right.end, axis.end])
  line1 = line(start = [var 4.35mm, var 0mm], end = [var 0.43mm, var 0mm])
  coincident([line1.start, right.start])
  coincident([line1.end, left.start])
  coincident([axis.start, ORIGIN])
}

solid = extrude(region(point = [0mm, 0.1mm], sketch = profile), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::symmetric function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-symmetric0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-symmetric0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


