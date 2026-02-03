---
title: "startSketchOn"
subtitle: "Function in std::sketch"
excerpt: "Start a new 2-dimensional sketch on a specific plane or face."
layout: manual
---

Start a new 2-dimensional sketch on a specific plane or face.

```kcl
startSketchOn(
  @planeOrSolid: Solid | Plane,
  face?: TaggedFace,
  normalToFace?: TaggedFace,
  alignAxis?: Axis2d,
  normalOffset?: number(Length),
): Plane | Face
```

### Sketch on Face Behavior

There are some important behaviors to understand when sketching on a face:

The resulting sketch will _include_ the face and thus Solid
that was sketched on. So say you were to export the resulting Sketch / Solid
from a sketch on a face, you would get both the artifact of the sketch
on the face and the parent face / Solid itself.

This is important to understand because if you were to then sketch on the
resulting Solid, it would again include the face and parent Solid that was
sketched on. This could go on indefinitely.

The point is if you want to export the result of a sketch on a face, you
only need to export the final Solid that was created from the sketch on the
face, since it will include all the parent faces and Solids.

See [sketch on face](/docs/kcl-lang/sketch-on-face) for more details.

### Multiple Profiles

When creating multiple profiles in a sketch, each profile must be made
separately and assigned to a variable. Using one pipeline to create multiple
profiles, where one profile is piped into the next, is not currently
supported.

```js
// This does NOT work.
twoSquares = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
  |> startProfile(at = [20, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
twoCubes = extrude(twoSquares, length = 10)
```

Instead, use separate pipelines, and extrude an array of them all.

```js
sketch1 = startSketchOn(XY)
squareProfile1 = startProfile(sketch1, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
squareProfile2 = startProfile(sketch1, at = [20, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
twoCubes = extrude([squareProfile1, squareProfile2], length = 10)
```

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `planeOrSolid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) or [`Plane`](/docs/kcl-std/types/std-types-Plane) | Profile whose start is being used. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Identify a face of a solid if a solid is specified as the input argument (`planeOrSolid`). Incompatible with `normalToFace`. | No |
| `normalToFace` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Identify a face of a solid if a solid is specified as the input argument. Starts a sketch on the plane orthogonal to this specified face. Incompatible with `face`, requires `alignAxis`. | No |
| `alignAxis` | [`Axis2d`](/docs/kcl-std/types/std-types-Axis2d) | If sketching normal to face, this axis will be the new local x axis of the sketch plane. The selected face's normal will be the local y axis. Incompatible with `face`, requires `normalToFace`. | No |
| `normalOffset` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Offset the sketch plane along its normal by the given amount. Incompatible with `face`, requires `normalToFace`. | No |

### Returns

[`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face)


### Examples

```kcl
exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 5)

exampleSketch002 = startSketchOn(example, face = END)
  |> startProfile(at = [1, 1])
  |> line(end = [8, 0])
  |> line(end = [0, 8])
  |> line(end = [-8, 0])
  |> close()

example002 = extrude(exampleSketch002, length = 5)

exampleSketch003 = startSketchOn(example002, face = END)
  |> startProfile(at = [2, 2])
  |> line(end = [6, 0])
  |> line(end = [0, 6])
  |> line(end = [-6, 0])
  |> close()

example003 = extrude(exampleSketch003, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch on the end of an extruded face by tagging the end face.

exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 5, tagEnd = $end01)

exampleSketch002 = startSketchOn(example, face = end01)
  |> startProfile(at = [1, 1])
  |> line(end = [8, 0])
  |> line(end = [0, 8])
  |> line(end = [-8, 0])
  |> close()

example002 = extrude(exampleSketch002, length = 5, tagEnd = $end02)

exampleSketch003 = startSketchOn(example002, face = end02)
  |> startProfile(at = [2, 2])
  |> line(end = [6, 0])
  |> line(end = [0, 6])
  |> line(end = [-6, 0])
  |> close()

example003 = extrude(exampleSketch003, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10], tag = $sketchingFace)
  |> line(end = [-10, 0])
  |> close()

example = extrude(exampleSketch, length = 10)

exampleSketch002 = startSketchOn(example, face = sketchingFace)
  |> startProfile(at = [1, 1])
  |> line(end = [8, 0])
  |> line(end = [0, 8])
  |> line(end = [-8, 0])
  |> close(tag = $sketchingFace002)

example002 = extrude(exampleSketch002, length = 10)

exampleSketch003 = startSketchOn(example002, face = sketchingFace002)
  |> startProfile(at = [-8, 12])
  |> line(end = [0, 6])
  |> line(end = [6, 0])
  |> line(end = [0, -6])
  |> close()

example003 = extrude(exampleSketch003, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
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

example = revolve(exampleSketch, axis = Y, angle = 180deg)

exampleSketch002 = startSketchOn(example, face = END)
  |> startProfile(at = [4.5, -5])
  |> line(end = [0, 5])
  |> line(end = [5, 0])
  |> line(end = [0, -5])
  |> close()

example002 = extrude(exampleSketch002, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch on the end of a revolved face by tagging the end face.

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

example = revolve(
  exampleSketch,
  axis = Y,
  angle = 180deg,
  tagEnd = $end01,
)

exampleSketch002 = startSketchOn(example, face = end01)
  |> startProfile(at = [4.5, -5])
  |> line(end = [0, 5])
  |> line(end = [5, 0])
  |> line(end = [0, -5])
  |> close()

example002 = extrude(exampleSketch002, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
a1 = startSketchOn({
       origin = { x = 0, y = 0, z = 0 },
       xAxis = { x = 1, y = 0, z = 0 },
       yAxis = { x = 0, y = 1, z = 0 },
       zAxis = { x = 0, y = 0, z = 1 }
     })
  |> startProfile(at = [0, 0])
  |> line(end = [100.0, 0])
  |> yLine(length = -100.0)
  |> xLine(length = -100.0)
  |> yLine(length = 100.0)
  |> close()
  |> extrude(length = 3.14)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sketch001 = startSketchOn(XY)
  |> startProfile(at = [-5, -5])
  |> xLine(length = 10)
  |> yLine(length = 10, tag = $b)
  |> xLine(length = -10)
  |> close()

cube001 = extrude(sketch001, length = 10)
  |> rotate(roll = 10, pitch = 20, yaw = 30)

sketch002 = startSketchOn(cube001, normalToFace = END, alignAxis = Y)
  |> circle(radius = 2, center = [0, 0])
cube002 = extrude(sketch002, length = 4)

subtract(cube001, tools = cube002)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


