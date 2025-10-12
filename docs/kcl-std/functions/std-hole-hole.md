---
title: "hole::hole"
subtitle: "Function in std::hole"
excerpt: "From the hole's parts (bottom, middle, top), cut the hole into the given solid, at the given 2D position on the given face."
layout: manual
---

From the hole's parts (bottom, middle, top), cut the hole into the given solid, at the given 2D position on the given face.

```kcl
hole::hole(
  @solid,
  face,
  holeBottom,
  holeBody,
  holeType,
  cutAt,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` |  |  | Yes |
| `face` |  |  | Yes |
| `holeBottom` |  |  | Yes |
| `holeBody` |  |  | Yes |
| `holeType` |  |  | Yes |
| `cutAt` |  |  | Yes |


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


