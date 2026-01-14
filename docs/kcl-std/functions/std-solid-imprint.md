---
title: "imprint"
subtitle: "Function in std::solid"
excerpt: "Imprint multiple bodies into one. From the outside, the result looks visually similar to a union, but where the two solids overlap, their interiors aren't merged. The internal shells of each solid are maintained. If you then deleted all the faces of shape A, you'd still be left with all the faces of shape B."
layout: manual
---

Imprint multiple bodies into one. From the outside, the result looks visually similar to a union, but where the two solids overlap, their interiors aren't merged. The internal shells of each solid are maintained. If you then deleted all the faces of shape A, you'd still be left with all the faces of shape B.

```kcl
imprint(@bodies: [Solid; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `bodies` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 2+] | The bodies to imprint together. | Yes |


### Examples

```kcl
sideLen = 4

// Helper function to make a square surface body.
fn square(@plane, offset, y) {
  at = if y {
    [-offset, 0]
  } else {
    [0, offset]
  }
  return startSketchOn(plane)
    |> startProfile(at)
    |>     if y {
      yLine(length = sideLen)
    } else {
      xLine(length = sideLen)
    }
    |> extrude(
         length =       if y {
        -sideLen
      } else {
        sideLen
      },
         bodyType = SURFACE,
       )
}

// Make a cube polysurface from 6 squares.
cube = [
  square(XY, offset = 0, y = false),
  square(XZ, offset = 0, y = true)
  |> invert(),
  square(YZ, offset = 0, y = false),
  square(XY, offset = sideLen, y = false),
  square(XZ, offset = -sideLen, y = true),
  square(YZ, offset = sideLen, y = false)
]

// Via imprint, create a solid cube from the 6 square surfaces (faces of the cube).
cubeSolid = imprint(cube)

// To prove it's solid, we can set the whole cube's appearance.
appearance(
  cubeSolid,
  color = "#da4333",
  roughness = 50,
  metalness = 90,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the imprint function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-imprint0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-imprint0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


