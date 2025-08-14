---
title: "close"
subtitle: "Function in std::sketch"
excerpt: "Construct a line segment from the current origin back to the profile's origin, ensuring the resulting 2-dimensional sketch is not open-ended."
layout: manual
---

Construct a line segment from the current origin back to the profile's origin, ensuring the resulting 2-dimensional sketch is not open-ended.

```kcl
close(
  @sketch: Sketch,
  tag?: TagDecl,
): Sketch
```

If you want to perform some 3-dimensional operation on a sketch, like
extrude or sweep, you must `close` it first. `close` must be called even
if the end point of the last segment is coincident with the sketch
starting point.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | The sketch you want to close. | Yes |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 10])
  |> line(end = [10, 0])
  |> close()
  |> extrude(length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-close0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-close0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
exampleSketch = startSketchOn(-XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-close1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-close1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


