---
title: "split"
subtitle: "Function in std::solid"
excerpt: "Split all faces of the target body along all faces of the tool bodies."
layout: manual
---

Split all faces of the target body along all faces of the tool bodies.

```kcl
split(
  @targets: [Solid; 1+],
  merge?: bool,
  keepTools?: bool,
  tools?: [Solid],
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `targets` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The bodies to split | Yes |
| `merge` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether to merge the bodies into one after. Defaults to false. | No |
| `keepTools` | [`bool`](/docs/kcl-std/types/std-types-bool) | If false, the tool bodies will be removed from the scene. If true, they'll be kept. Defaults to false. | No |
| `tools` | [[`Solid`](/docs/kcl-std/types/std-types-Solid)] | The tools to split the target bodies along. | No |

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

```kcl
cube1 = startSketchOn(XY)
  |> rectangle(width = 3, height = 3, center = [0, 0])
  |> extrude(length = 2)

cube2 = startSketchOn(offsetPlane(XY, offset = 0.4))
  |> rectangle(width = 3, height = 3, center = [2, 2])
  |> extrude(length = 2)

cubes = split([cube1], tools = [cube2], merge = true)
  |> appearance(
       color = "#da4333",
       roughness = 50,
       metalness = 90,
       opacity = 80,
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the split function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-split1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-split1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
goldCube = startSketchOn(XY)
  |> rectangle(width = 10, height = 10, center = [0, 0])
  |> extrude(length = 10)
  |> appearance(color = "#da7333", roughness = 50, metalness = 90)

roseCube = startSketchOn(offsetPlane(XY, offset = 2))
  |> rectangle(width = 10, height = 10, center = [4, 2])
  |> extrude(length = 10)
  |> appearance(color = "#da4333", roughness = 50, metalness = 90)

// Split the gold cube along the edges of rose cube. Keep rose cube in place after.
final = split(
  [goldCube],
  tools = [roseCube],
  merge = true,
  keepTools = true,
)
// You can't see it, because the rose cube is covering it, but the gold cube now has
// had its faces split along the edges of the rose cube.

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the split function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-split2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-split2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
goldCube = startSketchOn(XY)
  |> rectangle(width = 10, height = 10, center = [0, 0])
  |> extrude(length = 10)
  |> appearance(color = "#da7333", roughness = 50, metalness = 90)

roseCube = startSketchOn(offsetPlane(XY, offset = 2))
  |> rectangle(width = 10, height = 10, center = [4, 2])
  |> extrude(length = 10)
  |> appearance(color = "#da4333", roughness = 50, metalness = 90)

// Split the gold cube along the edges of rose cube.
// Then delete some of the new faces that were created on gold cube.
final = split([goldCube], tools = [roseCube], merge = true)
  |> deleteFace(faceIndices = [6, 8])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the split function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-split3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-split3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Make a cylinder.
sketch001 = startSketchOn(XY)
profile001 = circle(
  sketch001,
  center = [0, 0],
  radius = 4.09,
  tag = $seg01,
)
cylinder = extrude(profile001, length = 5)

// Make a wedge that splits the cylinder down the middle.
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [0, -4.75])
  |> angledLine(angle = 0deg, length = 2, tag = $a)
  |> angledLine(angle = segAng(a) + 90deg, length = 9.5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
wedge = extrude(profile002, length = 15, symmetric = true)

// Split the cylinder down the wedge.
result = split([cylinder], tools = [wedge])

// Color each part of the split cylinder differently,
// and move the parts a bit away from each other,
// so you can see their interiors.
left = appearance(result[2], color = "#B2FFD6")
  |> translate(x = -4)

middle = appearance(result[1], color = "#F6AE2D")

right = appearance(result[0], color = "#AA78A6")
  |> translate(x = 4)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the split function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-split4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-split4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


