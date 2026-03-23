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


