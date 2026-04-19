---
title: "flipSurface"
subtitle: "Function in std::solid"
excerpt: "Flips the orientation of a surface, swapping which side is the front and which is the reverse."
layout: manual
---

Flips the orientation of a surface, swapping which side is the front and which is the reverse.

```kcl
flipSurface(@surface: [Solid; 1+]): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `surface` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The surfaces to flip (swap the surface's back and front sides) | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
sideLen = 4

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

// Make a cube polysurface from 6 squares
cube = [
  square(XY, offset = 0, y = false),
  square(XZ, offset = 0, y = true)
    |> flipSurface(),
  square(YZ, offset = 0, y = false),
  square(XY, offset = sideLen, y = false),
  square(XZ, offset = -sideLen, y = true),
  square(YZ, offset = sideLen, y = false)
]

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the flipSurface function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-flipSurface0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-flipSurface0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sideLen = 4

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

// Make a cube polysurface from 6 squares
cube = [
  square(XY, offset = 0, y = false),
  square(XZ, offset = 0, y = true)
    |> flipSurface(),
  square(YZ, offset = 0, y = false),
  square(XY, offset = sideLen, y = false),
  square(XZ, offset = -sideLen, y = true),
  square(YZ, offset = sideLen, y = false)
]
// Flip the cube inside out
flipSurface(cube)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the flipSurface function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-flipSurface1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-flipSurface1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


