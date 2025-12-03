---
title: "patternLinear3d"
subtitle: "Function in std::solid"
excerpt: "Repeat a 3-dimensional solid along a linear path, with a dynamic amount of distance between each repetition, some specified number of times."
layout: manual
---

Repeat a 3-dimensional solid along a linear path, with a dynamic amount of distance between each repetition, some specified number of times.

```kcl
patternLinear3d(
  @solids: [Solid; 1+],
  instances: number(_),
  distance: number(Length),
  axis: Axis3d | Point3d,
  useOriginal?: bool,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The solid(s) to duplicate. | Yes |
| `instances` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | Yes |
| `distance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance between each repetition. Also known as 'spacing'. | Yes |
| `axis` | [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Point3d`](/docs/kcl-std/types/std-types-Point3d) | The axis of the pattern. A 3D vector. | Yes |
| `useOriginal` | [`bool`](/docs/kcl-std/types/std-types-bool) | If the target was sketched on an extrusion, setting this will use the original sketch as the target, not the entire joined solid. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
// / Pattern using a named axis.

exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 2])
  |> line(end = [3, 1])
  |> line(end = [0, -4])
  |> close()

example = extrude(exampleSketch, length = 1)
  |> patternLinear3d(axis = X, instances = 7, distance = 6)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternLinear3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternLinear3d0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternLinear3d0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// / Pattern using a raw axis.

exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 2])
  |> line(end = [3, 1])
  |> line(end = [0, -4])
  |> close()

example = extrude(exampleSketch, length = 1)
  |> patternLinear3d(axis = [1, 0, 1], instances = 7, distance = 6)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternLinear3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternLinear3d1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternLinear3d1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Pattern a whole sketch on face.
size = 100
case = startSketchOn(XY)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close(%)
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

thing2 = startSketchOn(case, face = END)
  |> circle(center = [size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

  // We pass in the "case" here since we want to pattern the whole sketch.
// And the case was the base of the sketch.
patternLinear3d(
  case,
  axis = [1, 0, 0],
  distance = 250,
  instances = 2,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternLinear3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternLinear3d2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternLinear3d2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Pattern an object on a face.
size = 100
case = startSketchOn(XY)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close(%)
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

// We pass in `thing1` here with `useOriginal` since we want to pattern just this object on the face.
patternLinear3d(
  thing1,
  axis = [1, 0, 0],
  distance = size,
  instances = 2,
  useOriginal = true,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the patternLinear3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-patternLinear3d3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-patternLinear3d3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


