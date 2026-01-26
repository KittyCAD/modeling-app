---
title: "deleteFace"
subtitle: "Function in std::solid"
excerpt: "Delete a face from a body (a solid, or a polysurface)."
layout: manual
---

Delete a face from a body (a solid, or a polysurface).

```kcl
deleteFace(
  @body: Solid,
  faces?: [TaggedFace; 1+],
  faceIndices?: [number(_); 1+],
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Target to delete a surface from. | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | Face to delete. This is the usual face representation, e.g. a tagged face. | No |
| `faceIndices` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 1+] | Face to delete. The index is a stable ordering of faces, used when you can't get the usual ID (UUID) of a face. | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Make an extruded triangle.
startSketchOn(XY)
  |> startProfile(at = [0, 15])
  |> xLine(length = 10, tag = $a)
  |> yLine(length = 8)
  |> close()
  |> extrude(length = 2)
  // Delete some faces.
  |> deleteFace(faces = [a, END])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the deleteFace function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-deleteFace0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-deleteFace0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Make an extruded square.
startSketchOn(XY)
  |> polygon(radius = 10, numSides = 4, center = [0, 0])
  |> extrude(length = 2)
  // Delete some faces. Because there's no tags, we can delete by face _index_.
  |> deleteFace(faceIndices = [0, 5])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the deleteFace function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-deleteFace1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-deleteFace1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

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

// We can delete faces using their face index, because there's no tags on this cube.
deleteFace(cubeSolid, faceIndices = [0, 1])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the deleteFace function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-deleteFace2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-deleteFace2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


