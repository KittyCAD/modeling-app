---
title: "tangentToEnd"
subtitle: "Function in std::sketch"
excerpt: "Returns the angle coming out of the end of the segment in degrees."
layout: manual
---

Returns the angle coming out of the end of the segment in degrees.

```kcl
tangentToEnd(@tag: TaggedEdge): number(Angle)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The line segment being queried by its tag. | Yes |

### Returns

[`number(Angle)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
// Horizontal pill.
pillSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [20, 0])
  |> tangentialArc(end = [0, 10], tag = $arc1)
  |> angledLine(angle = tangentToEnd(arc1), length = 20)
  |> tangentialArc(end = [0, -10])
  |> close()

pillExtrude = extrude(pillSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentToEnd function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentToEnd0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentToEnd0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Vertical pill.  Use absolute coordinate for arc.
pillSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [0, 20])
  |> tangentialArc(endAbsolute = [10, 20], tag = $arc1)
  |> angledLine(angle = tangentToEnd(arc1), length = 20)
  |> tangentialArc(end = [-10, 0])
  |> close()

pillExtrude = extrude(pillSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentToEnd function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentToEnd1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentToEnd1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
rectangleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0], tag = $seg1)
  |> angledLine(angle = tangentToEnd(seg1), length = 10)
  |> line(end = [0, 10])
  |> line(end = [-20, 0])
  |> close()

rectangleExtrude = extrude(rectangleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentToEnd function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentToEnd2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentToEnd2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
bottom = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> arc(endAbsolute = [10, 10], interiorAbsolute = [5, 1], tag = $arc1)
  |> angledLine(angle = tangentToEnd(arc1), length = 20)
  |> close()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentToEnd function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentToEnd3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentToEnd3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
circSketch = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 3, tag = $circ)

triangleSketch = startSketchOn(XY)
  |> startProfile(at = [-5, 0])
  |> angledLine(angle = tangentToEnd(circ), length = 10)
  |> line(end = [-15, 0])
  |> close()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the tangentToEnd function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-tangentToEnd4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-tangentToEnd4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


