---
title: "hole::flat"
subtitle: "Function in std::hole"
excerpt: "End the hole flat."
layout: manual
---

End the hole flat.

```kcl
hole::flat()
```





### Examples

```kcl
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

// Add a hole with a flat bottom.
bigCube
  |> hole::hole(
       face = a,
       cutAt = [0, 0],
       holeBottom = hole::flat(),
       holeBody = hole::blind(depth = 2, diameter = 8),
       holeType = hole::simple(),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::flat function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-flat0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-flat0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


