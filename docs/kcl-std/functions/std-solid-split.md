---
title: "split"
subtitle: "Function in std::solid"
excerpt: "Split a body into two parts: the part that overlaps with a tool, and the part that doesn't."
layout: manual
---

Split a body into two parts: the part that overlaps with a tool, and the part that doesn't.

```kcl
split(
  @targets: [Solid; 1+],
  merge: bool,
  tools?: [Solid],
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `targets` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The bodies to split | Yes |
| `merge` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether to merge the bodies into one after. Currently, we only support merge = true. | Yes |
| `tools` | [[`Solid`](/docs/kcl-std/types/std-types-Solid)] | The tools to split the bodies along. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


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
    |> if y {
      yLine(length = sideLen)
    } else {
      xLine(length = sideLen)
    }
    |> extrude(
         length = if y {
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
  |> flipSurface(),
  square(YZ, offset = 0, y = false),
  square(XY, offset = sideLen, y = false),
  square(XZ, offset = -sideLen, y = true),
  square(YZ, offset = sideLen, y = false)
]

// Via split + merge, create a solid cube from the 6 square surfaces (faces of the cube).
cubeSolid = split(cube, merge = true)

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
  alt="Example showing a rendered KCL program that uses the split function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-split0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-split0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


