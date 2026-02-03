---
title: "subtract2d"
subtitle: "Function in std::sketch"
excerpt: "Use a 2-dimensional sketch to cut a hole in another 2-dimensional sketch."
layout: manual
---

Use a 2-dimensional sketch to cut a hole in another 2-dimensional sketch.

```kcl
subtract2d(
  @sketch: Sketch,
  tool: [Sketch; 1+],
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `tool` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] | The shape(s) which should be cut out of the sketch. | Yes |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 5])
  |> line(end = [5, 0])
  |> line(end = [0, -5])
  |> close()
  |> subtract2d(tool = circle(center = [1, 1], radius = .25))
  |> subtract2d(tool = circle(center = [1, 4], radius = .25))

example = extrude(exampleSketch, length = 1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the subtract2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-subtract2d0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-subtract2d0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
fn squareHoleSketch() {
  squareSketch = startSketchOn(-XZ)
    |> startProfile(at = [-1, -1])
    |> line(end = [2, 0])
    |> line(end = [0, 2])
    |> line(end = [-2, 0])
    |> close()
  return squareSketch
}

exampleSketch = startSketchOn(-XZ)
  |> circle(center = [0, 0], radius = 3)
  |> subtract2d(tool = squareHoleSketch())
example = extrude(exampleSketch, length = 1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the subtract2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-subtract2d1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-subtract2d1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


