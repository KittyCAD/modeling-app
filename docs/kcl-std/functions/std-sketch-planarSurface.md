---
title: "planarSurface"
subtitle: "Function in std::sketch"
excerpt: "Fills closed regions to make planar surfaces contained by their boundaries."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Fills closed regions to make planar surfaces contained by their boundaries.

```kcl
planarSurface(
  @curves: Sketch | [any; 1+],
  tolerance?: number(Length),
): [Solid; 1+]
```

Pass one region or a list of regions created with `region(...)`.
Each region creates a separate surface, so `planarSurface([region001, region002])`
returns two surfaces. A single region returns one surface.
Alternatively, pass a non-empty list of Face API edge selectors which form
one closed, connected, coplanar boundary to create one surface.
Regions and edge selectors cannot be mixed in the same call.
Edges must be provided in the order they connect.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `curves` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [[`any`](/docs/kcl-std/types/std-types-any); 1+] | Regions created with `region(...)`, or Face API edge selectors (`{ sideFaces, endFaces?, index? }`) enclosing one planar surface. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
// Select a closed region explicitly before filling it.
@settings(kclVersion = 3.0, experimentalFeatures = allow)

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

region001 = region(point = [0mm, 0mm], sketch = sketch001)
mySurface = planarSurface(region001)

```


![Rendered example of planarSurface 0](/kcl-test-outputs/serial_test_example_fn_std-sketch-planarSurface0.png)

```kcl
@settings(kclVersion = 3.0, experimentalFeatures = allow)

// In this example, we'll extrude a cylinder with no caps, then use
// `planarSurface` to create a separate surface for one cap.
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 0.87mm, var 0.63mm], center = [var -1.35mm, var 3mm])
}
hidden001 = hide(sketch001)
region001 = region(point = [-3.5682909mm, 5.3681754mm], sketch = sketch001)
extrude001 = extrude(region001, length = -5, bodyType = SURFACE)
cap = planarSurface([
  {
    sideFaces = [extrude001.sketch.tags.circle1],
    index = 0
  }
])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the planarSurface function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-planarSurface1_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-planarSurface1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


