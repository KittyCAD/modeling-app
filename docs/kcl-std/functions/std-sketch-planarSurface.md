---
title: "planarSurface"
subtitle: "Function in std::sketch"
excerpt: "Fills one closed region to make a single planar surface contained by its boundary."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Fills one closed region to make a single planar surface contained by its boundary.

```kcl
planarSurface(
  @curves: Sketch | [TaggedEdge; 1+] | [Edge; 1+] | [Segment; 1+],
  tolerance?: number(Length),
): Solid
```

A sketch must contain exactly one region, and that region must be closed.
Alternatively, pass a non-empty list of edges or segments which form one
closed, connected, coplanar region. List items must be provided in the
order they connect.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `curves` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [[`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge); 1+] or [[`Edge`](/docs/kcl-std/types/std-types-Edge); 1+] or [[`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | Which closed 2D region of space should be filled in to make a planar surface. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// Sketch a closed quadrilateral
sketch001 = sketch(on = XY) {
  line1 = line(start = [var -3.33mm, var 2.33mm], end = [var -3.28mm, var -3.27mm])
  line2 = line(start = [var -3.28mm, var -3.27mm], end = [var 3.97mm, var -2.69mm])
  line3 = line(start = [var 3.97mm, var -2.69mm], end = [var 3.94mm, var 1.55mm])
  line4 = line(start = [var 3.94mm, var 1.55mm], end = [var -3.33mm, var 2.33mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

// Fill the single closed region with one surface.
mySurface = planarSurface([
  sketch001.line1,
  sketch001.line2,
  sketch001.line3,
  sketch001.line4
])

```


![Rendered example of planarSurface 0](/kcl-test-outputs/serial_test_example_fn_std-sketch-planarSurface0.png)

```kcl
// If the sketch only has 1 region, and it's closed, then you can just pass
// the sketch itself in, without needing to specify the region or the bounding segments.
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// Sketch a closed quadrilateral
sketch001 = sketch(on = XY) {
  line1 = line(start = [var -3.33mm, var 2.33mm], end = [var -3.28mm, var -3.27mm])
  line2 = line(start = [var -3.28mm, var -3.27mm], end = [var 3.97mm, var -2.69mm])
  line3 = line(start = [var 3.97mm, var -2.69mm], end = [var 3.94mm, var 1.55mm])
  line4 = line(start = [var 3.94mm, var 1.55mm], end = [var -3.33mm, var 2.33mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

// Fill the sketch's single closed region with one surface.
mySurface = planarSurface(sketch001)

```


![Rendered example of planarSurface 1](/kcl-test-outputs/serial_test_example_fn_std-sketch-planarSurface1.png)

```kcl
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// In this example, we'll extrude a cylinder with no caps, then use
// `planarSurface` to create a separate surface for one cap.
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 0.87mm, var 0.63mm], center = [var -1.35mm, var 3mm])
}
hidden001 = hide(sketch001)
region001 = region(point = [-3.5682909mm, 5.3681754mm], sketch = sketch001)
extrude001 = extrude(region001, length = -5, bodyType = SURFACE)
cap = planarSurface([extrude001.sketch.tags.circle1])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the planarSurface function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-planarSurface2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-planarSurface2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


