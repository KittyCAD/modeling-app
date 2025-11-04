---
title: "appearance"
subtitle: "Function in std::solid"
excerpt: "Set the appearance of a solid. This only works on solids, not sketches or individual paths."
layout: manual
---

Set the appearance of a solid. This only works on solids, not sketches or individual paths.

```kcl
appearance(
  @solids: [Solid; 1+] | ImportedGeometry,
  color: string,
  metalness?: number(_),
  roughness?: number(_),
): [Solid; 1+] | ImportedGeometry
```

This will work on any solid, including extruded solids, revolved solids, and shelled solids.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The The solid(s) whose appearance is being set. | Yes |
| `color` | [`string`](/docs/kcl-std/types/std-types-string) | Color of the new material, a hex string like '#ff0000'. | Yes |
| `metalness` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Metalness of the new material, a percentage like 95.7. | No |
| `roughness` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Roughness of the new material, a percentage like 95.7. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Add color to an extruded solid.
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [10, 0])
  |> line(endAbsolute = [0, 10])
  |> line(endAbsolute = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 5)
  // There are other options besides 'color', but they're optional.
  |> appearance(color = '#ff0000')

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Add color to a revolved solid.
sketch001 = startSketchOn(XY)
  |> circle(center = [15, 0], radius = 5)
  |> revolve(angle = 360deg, axis = Y)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Add color to different solids.
fn cube(center) {
  return startSketchOn(XY)
    |> startProfile(at = [center[0] - 10, center[1] - 10])
    |> line(endAbsolute = [center[0] + 10, center[1] - 10])
    |> line(endAbsolute = [center[0] + 10, center[1] + 10])
    |> line(endAbsolute = [center[0] - 10, center[1] + 10])
    |> close()
    |> extrude(length = 10)
}

example0 = cube(center = [0, 0])
example1 = cube(center = [20, 0])
example2 = cube(center = [40, 0])

appearance(
  [example0, example1],
  color = '#ff0000',
  metalness = 50,
  roughness = 50,
)
appearance(
  example2,
  color = '#00ff00',
  metalness = 50,
  roughness = 50,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// You can set the appearance before or after you shell it will yield the same result.
// This example shows setting the appearance _after_ the shell.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)

shell(firstSketch, faces = [END], thickness = 0.25)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// You can set the appearance before or after you shell it will yield the same result.
// This example shows setting the appearance _before_ the shell.
firstSketch = startSketchOn(XY)
  |> startProfile(at = [-12, 12])
  |> line(end = [24, 0])
  |> line(end = [0, -24])
  |> line(end = [-24, 0])
  |> close()
  |> extrude(length = 6)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)

shell(firstSketch, faces = [END], thickness = 0.25)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Setting the appearance of a 3D pattern can be done _before_ or _after_ the pattern.
// This example shows _before_ the pattern.
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 2])
  |> line(end = [3, 1])
  |> line(end = [0, -4])
  |> close()

example = extrude(exampleSketch, length = 1)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)
  |> patternLinear3d(axis = [1, 0, 1], instances = 7, distance = 6)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Setting the appearance of a 3D pattern can be done _before_ or _after_ the pattern.
// This example shows _after_ the pattern.
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 2])
  |> line(end = [3, 1])
  |> line(end = [0, -4])
  |> close()

example = extrude(exampleSketch, length = 1)
  |> patternLinear3d(axis = [1, 0, 1], instances = 7, distance = 6)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Color the result of a 2D pattern that was extruded.
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [.5, 25])
  |> line(end = [0, 5])
  |> line(end = [-1, 0])
  |> line(end = [0, -5])
  |> close()
  |> patternCircular2d(
       center = [0, 0],
       instances = 13,
       arcDegrees = 360,
       rotateDuplicates = true,
     )

example = extrude(exampleSketch, length = 1)
  |> appearance(color = '#ff0000', metalness = 90, roughness = 90)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Color the result of a sweep.

// Create a path for the sweep.
sweepPath = startSketchOn(XZ)
  |> startProfile(at = [0.05, 0.05])
  |> line(end = [0, 7])
  |> tangentialArc(angle = 90deg, radius = 5)
  |> line(end = [-3, 0])
  |> tangentialArc(angle = -90deg, radius = 5)
  |> line(end = [0, 7])

pipeHole = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 1.5)

sweepSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 2)
  |> subtract2d(tool = pipeHole)
  |> sweep(path = sweepPath)
  |> appearance(color = "#ff0000", metalness = 50, roughness = 50)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance8_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance8.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Change the appearance of an imported model.


import "tests/inputs/cube.sldprt" as cube

cube
  |> appearance(color = "#ff0000", metalness = 50, roughness = 50)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance9_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance9.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


