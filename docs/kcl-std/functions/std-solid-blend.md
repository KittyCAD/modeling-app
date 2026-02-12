---
title: "blend"
subtitle: "Function in std::solid"
excerpt: "Blend two surfaces together. Uses [bounded edges](/docs/kcl-std/types/std-types-BoundedEdge) to control the extents of the newly created surface."
layout: manual
---

Blend two surfaces together. Uses [bounded edges](/docs/kcl-std/types/std-types-BoundedEdge) to control the extents of the newly created surface.

```kcl
blend(@edges: [BoundedEdge; 2]): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `edges` | [[`BoundedEdge`](/docs/kcl-std/types/std-types-BoundedEdge); 2] | The two edges that will be blended. | Yes |

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


