---
title: "blend"
subtitle: "Function in std::solid"
excerpt: "Blend two surfaces together. Use [bounded edges](/docs/kcl-std/types/std-types-BoundedEdge) to control the extents of the newly created surface, or tagged edges to use the full edge span."
layout: manual
---

Blend two surfaces together. Use [bounded edges](/docs/kcl-std/types/std-types-BoundedEdge) to control the extents of the newly created surface, or tagged edges to use the full edge span.

```kcl
blend(@edges: [BoundedEdge | TaggedEdge; 2]): Solid
```

Or blend the full edges directly with tagged edges (no `getBoundedEdge`):

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `edges` | [[`BoundedEdge`](/docs/kcl-std/types/std-types-BoundedEdge) or [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge); 2] | The two edges that will be blended. Tagged edges blend the full edge length. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 0])
  |> angledLine(angle = 0deg, length = 4, tag = $rectangleSegmentA001)
  |> extrude(length = 2, bodyType = SURFACE)
  |> translate(y = 3, z = 2)

sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [-1, 0])
  |> angledLine(angle = 0deg, length = 2, tag = $rectangleSegmentA002)
  |> extrude(length = 2, bodyType = SURFACE)
  |> flipSurface()

edge001 = getBoundedEdge(
  profile001,
  edge = rectangleSegmentA001,
  lowerBound = 0.1,
  upperBound = 0.9,
)
edge002 = getBoundedEdge(profile002, edge = rectangleSegmentA002)

blend([edge001, edge002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the blend function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-blend0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-blend0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-2, 0])
  |> angledLine(angle = 0deg, length = 4, tag = $rectangleSegmentA001)
  |> extrude(length = 2, bodyType = SURFACE)
  |> translate(y = 3, z = 2)

sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [-1, 0])
  |> angledLine(angle = 0deg, length = 2, tag = $rectangleSegmentA002)
  |> extrude(length = 2, bodyType = SURFACE)
  |> flipSurface()

blend([
  rectangleSegmentA001,
  rectangleSegmentA002
])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the blend function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-blend1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-blend1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

sketch001 = sketch(on = YZ) {
  line1 = line(start = [var 4.1mm, var -0.1mm], end = [var 5.5mm, var 0mm])
  line2 = line(start = [var 5.5mm, var 0mm], end = [var 5.5mm, var 3mm])
  line3 = line(start = [var 5.5mm, var 3mm], end = [var 3.9mm, var 2.8mm])
  line4 = line(start = [var 4.1mm, var 3mm], end = [var 4.5mm, var -0.2mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

sketch002 = sketch(on = -XZ) {
  line5 = line(start = [var -5.3mm, var -0.1mm], end = [var -3.5mm, var -0.1mm])
  line6 = line(start = [var -3.5mm, var -0.1mm], end = [var -3.5mm, var 3.1mm])
  line7 = line(start = [var -3.5mm, var 4.5mm], end = [var -5.4mm, var 4.5mm])
  line8 = line(start = [var -5.3mm, var 3.1mm], end = [var -5.3mm, var -0.1mm])
  coincident([line5.end, line6.start])
  coincident([line6.end, line7.start])
  coincident([line7.end, line8.start])
  coincident([line8.end, line5.start])
}

region001 = region(point = [-4.4mm, 2mm], sketch = sketch002)
extrude001 = extrude(region001, length = -2mm, bodyType = SURFACE)
region002 = region(point = [4.8mm, 1.5mm], sketch = sketch001)
extrude002 = extrude(region002, length = -2mm, bodyType = SURFACE)

myBlend = blend([
  extrude001.sketch.tags.line7,
  extrude002.sketch.tags.line3
])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the blend function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-blend2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-blend2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


