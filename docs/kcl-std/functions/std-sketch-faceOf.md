---
title: "faceOf"
subtitle: "Function in std::sketch"
excerpt: "Get the face of a solid."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Get the face of a solid.

```kcl
faceOf(
  @solid: Solid,
  face: TaggedFace | Segment,
): Face
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid that has the face. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | Which face of the solid. | Yes |

### Returns

[`Face`](/docs/kcl-std/types/std-types-Face) - A face of a solid.


### Examples

```kcl
@settings(experimentalFeatures = allow)

triangle = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [2, 0])
  |> line(end = [0, 2], tag = $side)
  |> line(end = [-2, -2])
  |> close()
  |> extrude(length = 2)

// Get the face of the triangle's side face.
sideFace = faceOf(triangle, face = side)

// Create a new sketch, on the triangle's side face.
// sketch(on = sideFace) {}

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the faceOf function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-faceOf0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-faceOf0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

triangle = sketch(on = XY) {
  line1 = line(start = [var -0.05mm, var -0.01mm], end = [var 3.88mm, var 0.81mm])
  line2 = line(start = [var 3.88mm, var 0.81mm], end = [var 0.92mm, var 4.67mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 0.92mm, var 4.67mm], end = [var -0.03mm, var -0.04mm])
  coincident([line2.end, line3.start])
  coincident([line1.start, line3.end])
  horizontal(line1)
  equalLength([line2, line3])
}

triangleRegion = region(point = [1.86mm, 3.82mm], sketch = triangle)
prism = extrude(triangleRegion, length = 2)

face001 = faceOf(prism, face = triangleRegion.tags.line1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the faceOf function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-faceOf1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-faceOf1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


