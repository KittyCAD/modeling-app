---
title: "planarSurface"
subtitle: "Function in std::sketch"
excerpt: "Create a planar surface from a closed sketch, edge, segment or group of segments and edges."
layout: manual
---

Create a planar surface from a closed sketch, edge, segment or group of segments and edges.

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
// Any closed profile can be used to make a planar surface.
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var 0.87mm, var 0.63mm], center = [var -1.35mm, var 3mm])
}
hidden001 = hide(sketch001)
region001 = region(point = [-3.5682909mm, 5.3681754mm], sketch = sketch001)
extrude001 = extrude(region001, length = -5, bodyType = SURFACE)
planarSurface(extrude001.sketch.tags.circle1)

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


