---
title: "planarSurface"
subtitle: "Function in std::sketch"
excerpt: "Fills in a closed shape to make a surface, coplanar with the shape and entirely contained by it."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Fills in a closed shape to make a surface, coplanar with the shape and entirely contained by it.

```kcl
planarSurface(@sketches: [Sketch | TaggedEdge | Edge | Segment; 1+]): [Solid; 1+]
```

If a group of edges, segments, or sketches is provided,
they must be provided in the order they connect in.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Segment`](/docs/kcl-std/types/std-types-Segment); 1+] | Which sketch or sketches should be extruded. | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


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

// Fill in the closed shape with a surface.
mySurface = planarSurface([
  sketch001.line1,
  sketch001.line2,
  sketch001.line3,
  sketch001.line4
])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the planarSurface function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-planarSurface0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-planarSurface0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

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

// Fill in the closed shape with a surface.
mySurface = planarSurface(sketch001)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the planarSurface function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-planarSurface1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-planarSurface1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// In this example, we'll extrude a cylinder with no caps,
// then use `planarSurface` to add the cap.
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 0.87mm, var 0.63mm], center = [var -1.35mm, var 3mm])
}
hidden001 = hide(sketch001)
region001 = region(point = [-3.5682909mm, 5.3681754mm], sketch = sketch001)
extrude001 = extrude(region001, length = -5, bodyType = SURFACE)
cap = planarSurface(extrude001.sketch.tags.circle1)

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


