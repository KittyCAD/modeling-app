---
title: "solver::arc"
subtitle: "Function in std::solver"
excerpt: "Create a circular arc. By default, the arc segment sweeps counterclockwise from start to end. If the arc sweeps the wrong way, set `direction = CW` to make it sweep clockwise from start to end instead."
layout: manual
---

Create a circular arc. By default, the arc segment sweeps counterclockwise from start to end. If the arc sweeps the wrong way, set `direction = CW` to make it sweep clockwise from start to end instead.

```kcl
solver::arc(
  start: Point2d,
  end: Point2d,
  center: Point2d,
  direction?: string,
  construction?: bool,
): Segment
```

Use `direction = CW` to sweep the other way around the circle without
swapping the start and end points. This is the same shape as the first
example, but the arc travels from the base line's start to its end.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `start` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The point where the arc begins. | Yes |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The point where the arc ends. | Yes |
| `center` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The center of the circle the arc lies on. | Yes |
| `direction` | [`string`](/docs/kcl-std/types/std-types-string) | The direction that the arc sweeps from start to end: `CCW` for counterclockwise or `CW` for clockwise. Defaults to `CCW`. | No |
| `construction` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether this segment is construction geometry rather than part of the modeled profile. | No |

### Returns

[`Segment`](/docs/kcl-std/types/std-types-Segment) - A segment in a sketch created in a sketch block. It may be a line, arc, point, or other segment type.


### Examples

```kcl
profile = sketch(on = XY) {
  base = line(start = [var -5mm, var 0mm], end = [var 5mm, var 0mm])
  top = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var 5mm])
  coincident([base.end, top.start])
  coincident([base.start, top.end])
}

solid = extrude(region(segments = [profile.base, profile.top]), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::arc function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-arc0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-arc0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
height = 2
profile = sketch(on = XY) {
  arc1 = arc(start = [0, 0], end = [0, height], center = [0, height / 2])
}

```



```kcl
profile = sketch(on = XY) {
  base = line(start = [var -5mm, var 0mm], end = [var 5mm, var 0mm])
  top = arc(
    start = [var -5mm, var 0mm],
    end = [var 5mm, var 0mm],
    center = [var 0mm, var 5mm],
    direction = CW,
  )
  coincident([base.start, top.start])
  coincident([base.end, top.end])
}

solid = extrude(region(segments = [profile.base, profile.top]), length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the solver::arc function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solver-arc2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solver-arc2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


