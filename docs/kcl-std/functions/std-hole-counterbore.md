---
title: "hole::counterbore"
subtitle: "Function in std::hole"
excerpt: "Cut a straight vertical counterbore at the top of the hole."
layout: manual
---

Cut a straight vertical counterbore at the top of the hole.

```kcl
hole::counterbore(
  diameter,
  depth,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `diameter` |  |  | Yes |
| `depth` |  |  | Yes |


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
  alt="Example showing a rendered KCL program that uses the hole::counterbore function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-counterbore0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-counterbore0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


