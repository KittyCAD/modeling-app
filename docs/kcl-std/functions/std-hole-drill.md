---
title: "hole::drill"
subtitle: "Function in std::hole"
excerpt: "End the hole in an angle, like the end of a drill."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

End the hole in an angle, like the end of a drill.

```kcl
hole::drill(pointAngle: number(Angle))
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `pointAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |


### Examples

```kcl
// `hole` module is still experimental, so enable experimental features here.
@settings(experimentalFeatures = allow)

// Sketch a cube, so we have something to drill into.
cubeLen = 20
bigCube = startSketchOn(XY)
  |> startProfile(at = [-cubeLen / 2, -cubeLen / 2 + 10])
  |> line(end = [cubeLen, 0], tag = $a)
  |> line(end = [0, cubeLen], tag = $b)
  |> line(end = [-cubeLen, 0], tag = $c)
  |> line(end = [0, -cubeLen], tag = $d)
  |> close()
  |> extrude(length = cubeLen, symmetric = true)

// Add a hole with a very pointy drilled bottom.
bigCube
  |> hole::hole(
       face = a,
       cutAt = [0, 0],
       holeBottom = hole::drill(pointAngle = 25deg),
       holeBody = hole::blind(depth = 2, diameter = 8),
       holeType = hole::simple(),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::drill function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-drill0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-drill0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


