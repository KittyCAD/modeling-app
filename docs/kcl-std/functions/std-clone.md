---
title: "clone"
subtitle: "Function in std"
excerpt: "Clone a sketch or solid."
layout: manual
---

Clone a sketch or solid.

```kcl
clone(@geometry: Sketch | Solid | ImportedGeometry): Sketch | Solid | ImportedGeometry
```

This works essentially like a copy-paste operation. It creates a perfect replica
at that point in time that you can manipulate individually afterwards.

This doesn't really have much utility unless you need the equivalent of a double
instance pattern with zero transformations.

Really only use this function if YOU ARE SURE you need it. In most cases you
do not need clone and using a pattern with `instance = 2` is more appropriate.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `geometry` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Solid`](/docs/kcl-std/types/std-types-Solid) or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The sketch, solid, or imported geometry to be cloned. | Yes |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [`Solid`](/docs/kcl-std/types/std-types-Solid) or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Clone a basic sketch and move it and extrude it.
exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

clonedSketch = clone(exampleSketch)
  |> scale(x = 1.0, y = 1.0, z = 2.5)
  |> translate(x = 15.0, y = 0, z = 0)

extrude(clonedSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Clone a basic solid and move it.

exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

myPart = extrude(exampleSketch, length = 5)
clonedPart = clone(myPart)
  |> translate(x = 25.0)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Translate and rotate a cloned sketch to create a loft.

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> xLine(length = 20)
  |> yLine(length = -20)
  |> xLine(length = -20)
  |> close()

sketch002 = clone(sketch001)
  |> translate(x = 0, y = 0, z = 20)
  |> rotate(axis = [0, 0, 1.0], angle = 45)

loft([sketch001, sketch002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Translate a cloned solid. Fillet only the clone.

sketch001 = startSketchOn(XY)
  |> startProfile(at = [-10, 10])
  |> xLine(length = 20)
  |> yLine(length = -20)
  |> xLine(length = -20, tag = $face0)
  |> line(endAbsolute = [profileStart()], tag = $face1)
  |> extrude(length = 5, tagEnd = $end1)

sketch002 = clone(sketch001)
  |> translate(x = 0, y = 0, z = 20)

fillet(
  sketch002,
  radius = 2,
  tags = [
    getCommonEdge(faces = [
  sketch002.sketch.tags.face0,
  sketch002.sketch.tags.face1
])
  ],
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// You can reuse the tags from the original geometry with the cloned geometry.

sketch001 = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10], tag = $sketchingFace)
  |> line(end = [-10, 0])
  |> close()

sketch002 = clone(sketch001)
  |> translate(x = 15, y = 0, z = 5)
  |> extrude(length = 5)

startSketchOn(sketch002, face = sketch002.sketch.tags.sketchingFace)
  |> startProfile(at = [4, 6])
  |> line(end = [3, 0])
  |> line(end = [0, 3])
  |> line(end = [-3, 0])
  |> close()
  |> extrude(length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// You can also use the tags from the original geometry to fillet the cloned geometry.

width = 20
length = 10
thickness = 1
filletRadius = 2

mountingPlateSketch = startSketchOn(XY)
  |> startProfile(at = [-width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, -length / 2], tag = $edge1)
  |> line(endAbsolute = [width / 2, length / 2], tag = $edge2)
  |> line(endAbsolute = [-width / 2, length / 2], tag = $edge3)
  |> close(tag = $edge4)

mountingPlate = extrude(mountingPlateSketch, length = thickness)

clonedMountingPlate = clone(mountingPlate)

fillet(
       clonedMountingPlate,
       radius = filletRadius,
       tags = [
         getNextAdjacentEdge(clonedMountingPlate.sketch.tags.edge1),
         getNextAdjacentEdge(clonedMountingPlate.sketch.tags.edge2),
         getNextAdjacentEdge(clonedMountingPlate.sketch.tags.edge3),
         getNextAdjacentEdge(clonedMountingPlate.sketch.tags.edge4)
       ],
     )
  |> translate(x = 0, y = 50, z = 0)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Create a spring by sweeping around a helix path from a cloned sketch.

// Create a helix around the Z axis.
helixPath = helix(
  angleStart = 0,
  ccw = true,
  revolutions = 4,
  length = 10,
  radius = 5,
  axis = Z,
)

springSketch = startSketchOn(XZ)
  |> circle(center = [0, 0], radius = 1)

// Create a spring by sweeping around the helix path.
sweepedSpring = clone(springSketch)
  |> translate(x = 5)
  |> sweep(path = helixPath)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// A donut shape from a cloned sketch.
sketch001 = startSketchOn(XY)
  |> circle(center = [15, 0], radius = 5)

sketch002 = clone(sketch001)
  |> translate(z = 30)
  |> revolve(angle = 360, axis = Y)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch on the end of a revolved face by tagging the end face.
// This shows the cloned geometry will have the same tags as the original geometry.

exampleSketch = startSketchOn(XY)
  |> startProfile(at = [4, 12])
  |> line(end = [2, 0])
  |> line(end = [0, -6])
  |> line(end = [4, -6])
  |> line(end = [0, -6])
  |> line(end = [-3.75, -4.5])
  |> line(end = [0, -5.5])
  |> line(end = [-2, 0])
  |> close()

example001 = revolve(
  exampleSketch,
  axis = Y,
  angle = 180,
  tagEnd = $end01,
)

// example002 = clone(example001)
// |> translate(x = 0, y = 20, z = 0)


// Sketch on the cloned face.
// exampleSketch002 = startSketchOn(example002, face = example002.sketch.tags.end01)
// |> startProfile(at = [4.5, -5])
// |> line(end = [0, 5])
// |> line(end = [5, 0])
// |> line(end = [0, -5])
// |> close()


// example003 = extrude(exampleSketch002, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone8_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone8.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Clone an imported model.

import "tests/inputs/cube.sldprt" as cube

myCube = cube

clonedCube = clone(myCube)
  |> translate(x = 1020)
  |> appearance(color = "#ff0000", metalness = 50, roughness = 50)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the clone function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-clone9_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-clone9.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


