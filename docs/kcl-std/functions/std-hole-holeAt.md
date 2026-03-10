---
title: "hole::holeAt"
subtitle: "Function in std::hole"
excerpt: "Put a hole through the given targets, using a custom plane. The plane's origin determines the hole's center. The plane's X and Y axis determine which way the hole is pointing (it points down the normal i.e. Z axis, following the right-hand rule). This can be used to insert a hole where there is no face, or into a non-planar face."
layout: manual
---

Put a hole through the given targets, using a custom plane. The plane's origin determines the hole's center. The plane's X and Y axis determine which way the hole is pointing (it points down the normal i.e. Z axis, following the right-hand rule). This can be used to insert a hole where there is no face, or into a non-planar face.

```kcl
hole::holeAt(
  @targets,
  plane,
  holeBottom,
  holeBody,
  holeType,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `targets` |  |  | Yes |
| `plane` |  |  | Yes |
| `holeBottom` |  |  | Yes |
| `holeBody` |  |  | Yes |
| `holeType` |  |  | Yes |


### Examples

```kcl
// Model a cube.
cube1 = startSketchOn(XY)
  |> rectangle(width = 3, height = 3, center = [0, 0])
  |> extrude(length = 3, symmetric = true)

// Define a custom plane, into which a hole will be cut.
customPlane = {
  origin = { x = 0, y = 0, z = -2 },
  xAxis = { x = 1, y = 0, z = 0 },
  yAxis = { x = 0, y = 0, z = -1 }
}

// Cut the hole through the cube, into the plane.
hole::holeAt(
  [cube1],
  plane = customPlane,
  holeBottom = hole::flat(),
  holeBody = hole::blind(depth = 2, diameter = 1),
  holeType = hole::counterbore(diameter = 1.4, depth = 1),
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::holeAt function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-holeAt0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-holeAt0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


