---
title: "hole::holeAt"
subtitle: "Function in std::hole"
excerpt: "From the hole's parts (bottom, middle, top), cut the hole into the given solid, using the custom plane. The plane's origin determines the hole's center. The plane's X and Y axis determine which way the hole is pointing (it points down the normal i.e. Z axis, following the right-hand rule). This can be used to insert a hole where there is no face, or into a non-planar face."
layout: manual
---

From the hole's parts (bottom, middle, top), cut the hole into the given solid, using the custom plane. The plane's origin determines the hole's center. The plane's X and Y axis determine which way the hole is pointing (it points down the normal i.e. Z axis, following the right-hand rule). This can be used to insert a hole where there is no face, or into a non-planar face.

```kcl
hole::holeAt(
  @solids: [Solid; 1+],
  plane: Plane,
  holeBottom,
  holeBody,
  holeType,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | `[Solid; 1+]` | Which solid to add a hole to. | Yes |
| `plane` | `Plane` | The plane's origin determines the hole's center. The plane's X and Y axis determine which way the hole is pointing (it points down the normal i.e. Z axis, following the right-hand rule). | Yes |
| `holeBottom` |  | Define bottom feature of the hole. E.g. drilled or flat. | Yes |
| `holeBody` |  | Define the main length of the hole. E.g. a blind distance. | Yes |
| `holeType` |  | Define the top feature of the hole. E.g. countersink, counterbore, simple. | Yes |


### Examples

```kcl
// Model a cube.
cube1 = startSketchOn(XY)
  |> rectangle(width = 3, height = 3, center = [0, 0])
  |> extrude(length = 3)

// Define a custom plane, into which a hole will be cut.
customPlane = {
  origin = { x = 1.5, y = -1.5, z = 3 },
  xAxis = { x = -0.5, y = -0.5, z = 0 },
  yAxis = { x = 0, y = 0.5, z = 0.5 }
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


