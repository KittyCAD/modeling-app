---
title: "region"
subtitle: "Function in std::sketch"
excerpt: "Create a region from closed segments."
layout: manual
---

Create a region from closed segments.

```kcl
region(
  point?: Point2d | Segment,
  segments?: [Segment; 1+],
  intersectionIndex?: number(_),
  direction?: string,
  sketch?: any,
): Sketch
```

Prefer the `segments` parameter. It forms a region by tracing the first
segment from its start point to the intersection with the second segment,
then turning at each intersection using `direction` until returning to the
first segment.

For a single closed segment such as a circle, pass only that segment.
`intersectionIndex` and `direction` are unnecessary for one loop; use them
to disambiguate a boundary traced from multiple segments.

As a fallback, use the `point` parameter to select the closed boundary that
contains a given point. When using a 2D point rather than a point from the
sketch, provide the `sketch` parameter to specify which sketch the region is
from.

To make a fallback point move with a parametric sketch, consider creating a
construction point in the sketch and constraining it into place. You can then
refer to that point to create the region.

Operations such as `extrude`, `revolve`, and `sweep` consume the region
passed to them. Each region can be used by only one consuming operation. To
reuse the same profile, call `region(...)` again with the original sketch
segments instead of cloning the sketch. For example, create
`firstRegion = region(segments = [profile.circle])` and
`secondRegion = region(segments = [profile.circle])`, then pass each region
to a different consuming operation.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `point` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | A fallback point that is within the region's boundary. | No |
| `segments` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | The first two segments that form the region's boundary. In case of a circle, the one circle segment that forms the region. This is the preferred way to create a region. | No |
| `intersectionIndex` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Index of the intersection of the first segment with the second segment to use as the region's boundary. The default is `-1`, which uses the last intersection. This is usually only needed when two or more `segments` are provided. | No |
| `direction` | [`string`](/docs/kcl-std/types/std-types-string) | `CCW` for counterclockwise, `CW` for clockwise. Default is `CCW`. This is usually only needed when two or more `segments` are provided. | No |
| `sketch` | [`any`](/docs/kcl-std/types/std-types-any) | The sketch that the region is from. This is required when point is a [`Point2d`](/docs/kcl-std/types/std-types-Point2d). | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
@settings(kclVersion = 2.0)

// `region` traces counterclockwise by default.
triangle = sketch(on = XY) {
  line1 = line(start = [var -0.05mm, var -0.01mm], end = [var 3.88mm, var 0.81mm])
  line2 = line(start = [var 3.88mm, var 0.81mm], end = [var 0.92mm, var 4.67mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 0.92mm, var 4.67mm], end = [var -0.03mm, var -0.04mm])
  coincident([line2.end, line3.start])
  coincident([line1.start, line3.end])
  horizontal(line1)
  equalLength([line2, line3])
}

r = region(segments = [triangle.line1, triangle.line2])
extrude(r, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the region function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-region0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-region0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(kclVersion = 2.0)

// Set `direction = CW` when the segments trace the boundary clockwise.
trapezoid = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 0mm, var 3mm])
  line2 = line(start = [var 0mm, var 3mm], end = [var 4mm, var 3mm])
  line3 = line(start = [var 4mm, var 3mm], end = [var 4mm, var 0mm])
  line4 = line(start = [var 4mm, var 0mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  vertical(line1)
  horizontal(line2)
  parallel([line2, line4])
}

r = region(segments = [trapezoid.line1, trapezoid.line2], direction = CW)
extrude(r, length = 3)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the region function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-region1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-region1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
s = sketch(on = XY) {
  line1 = line(start = [var -5mm, var 0mm], end = [var 5mm, var 0mm])
  arc1 = arc(start = [var 5mm, var 0mm], end = [var -5mm, var 0mm], center = [var 0mm, var 6mm])
  coincident([line1.end, arc1.start])
  coincident([line1.start, arc1.end])
}

r = region(segments = [s.line1, s.arc1])
extrude(r, length = 2)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the region function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-region2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-region2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


