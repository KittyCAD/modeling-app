---
title: "hole::hole"
subtitle: "Function in std::hole"
excerpt: "From the hole's parts (bottom, middle, top), cut the hole into the given solid, at the given 2D position on the given face."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

From the hole's parts (bottom, middle, top), cut the hole into the given solid, at the given 2D position on the given face.

```kcl
hole::hole(
  @solid: Solid,
  face: TaggedFace,
  holeBottom,
  holeBody,
  holeType,
  cutAt: [number(Length); 2],
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
| `cutAt` | [[`number(Length)`](/docs/kcl-std/types/std-types-number); 2] | Where to place the cut on the given face of the solid. Given as absolute coordinates in the global scene. | Yes |


### Examples

```kcl
// `hole` module is still experimental, so enable experimental features here.
@settings(experimentalFeatures = allow)

// Model a cube
cubeLen = 20
bigCube = startSketchOn(XY)
  |> startProfile(at = [-cubeLen / 2, -cubeLen / 2 + 10])
  |> line(end = [cubeLen, 0], tag = $a)
  |> line(end = [0, cubeLen], tag = $b)
  |> line(end = [-cubeLen, 0], tag = $c)
  |> line(end = [0, -cubeLen], tag = $d)
  |> close()
  |> extrude(length = cubeLen, symmetric = true)
  |> translate(x = 5)

  // Add a hole to the cube.
// It'll have a drilled end, and a countersink (angled tip at the start).
bigCube
  |> hole::hole(
       face = a,
       cutAt = [0, 5],
       holeBottom = hole::drill(pointAngle = 110deg),
       holeBody = hole::blind(depth = 5, diameter = 8),
       holeType = hole::countersink(diameter = 14, angle = 100deg),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::hole function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-hole0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-hole0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// `hole` module is still experimental, so enable experimental features here.
@settings(experimentalFeatures = allow)

// Model a cube
cubeLen = 20
bigCube = startSketchOn(XY)
  |> startProfile(at = [-cubeLen / 2, -cubeLen / 2 + 10])
  |> line(end = [cubeLen, 0], tag = $a)
  |> line(end = [0, cubeLen], tag = $b)
  |> line(end = [-cubeLen, 0], tag = $c)
  |> line(end = [0, -cubeLen], tag = $d)
  |> close()
  |> extrude(length = cubeLen, symmetric = true)
  |> translate(x = 5)

  // Add a hole to the cube.
// It'll have a drilled end, and a counterbore (vertical hole that emerges from a larger hole)
bigCube
  |> hole::hole(
       face = a,
       cutAt = [0, 5],
       holeBottom = hole::drill(pointAngle = 110deg),
       holeBody = hole::blind(depth = 5, diameter = 8),
       holeType = hole::counterbore(diameter = 12, depth = 3.5),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::hole function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-hole1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-hole1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


