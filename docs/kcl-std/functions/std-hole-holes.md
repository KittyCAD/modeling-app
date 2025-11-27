---
title: "hole::holes"
subtitle: "Function in std::hole"
excerpt: "From the hole's parts (bottom, middle, top), cut the hole into the given solid, at each of the given 2D positions on the given face. Basically like function `hole` but it takes multiple 2D positions in `cutsAt`."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

From the hole's parts (bottom, middle, top), cut the hole into the given solid, at each of the given 2D positions on the given face. Basically like function `hole` but it takes multiple 2D positions in `cutsAt`.

```kcl
hole::holes(
  @solid: Solid,
  face: TaggedFace,
  holeBottom,
  holeBody,
  holeType,
  cutsAt: [[number(Length); 2]],
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Which solid to add a hole to. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Which face of the solid to add the hole to. Controls the orientation of the hole. | Yes |
| `holeBottom` |  | Define bottom feature of the hole. E.g. drilled or flat. | Yes |
| `holeBody` |  | Define the main length of the hole. E.g. a blind distance. | Yes |
| `holeType` |  | Define the top feature of the hole. E.g. countersink, counterbore, simple. | Yes |
| `cutsAt` | [[[`number(Length)`](/docs/kcl-std/types/std-types-number); 2]] | Where to place the holes, given as absolute coordinates in the global scene. | Yes |


### Examples

```kcl
@settings(experimentalFeatures = allow)

// Sketch a solid
sketch001 = startSketchOn(XY)
profile001 = startProfile(sketch001, at = [-3.89, 1.95])
  |> line(end = [0.63, -3.25])
  |> xLine(length = 7.15)
  |> line(end = [0.59, 3.2])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
mySolid = extrude(profile001, length = 3, symmetric = true)

// Add three holes to it.
hole001 = hole::holes(
  mySolid,
  face = END,
  cutsAt = [[0, 0], [0, 3], [1, 2]],
  holeBottom =   hole::drill(pointAngle = 110deg),
  holeBody =   hole::blind(depth = 2, diameter = 0.4),
  holeType =   hole::counterbore(diameter = 1, depth = 0.2),
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::holes function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-holes0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-holes0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


