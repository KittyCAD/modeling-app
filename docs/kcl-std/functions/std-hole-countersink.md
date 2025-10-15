---
title: "hole::countersink"
subtitle: "Function in std::hole"
excerpt: "Cut an angled countersink at the top of the hole. Typically used when a conical screw head has to sit flush with the surface being cut into."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Cut an angled countersink at the top of the hole. Typically used when a conical screw head has to sit flush with the surface being cut into.

```kcl
hole::countersink(
  diameter: number(Length),
  angle: number(Angle),
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `diameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |


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
  alt="Example showing a rendered KCL program that uses the hole::countersink function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-countersink0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-countersink0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


