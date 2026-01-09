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
  face: TaggedFace,
): Face
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid that has the face. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) | Which face of the solid. | Yes |

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


