---
title: "faceId"
subtitle: "Function in std"
excerpt: "Given a face index, find its ID."
layout: manual
---

Given a face index, find its ID.

```kcl
faceId(
  @body: Solid,
  index: number(_),
): TaggedFace
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `body` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose faces we're trying to find | Yes |
| `index` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Face to identify. The index is a stable ordering of faces, used when you can't get the usual ID of a face. | Yes |

### Returns

[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) - A tag which references a face of a solid, including the distinguished tags `START` and `END`.


### Examples

```kcl
// Cylinder
cylinder = startSketchOn(XY)
  |> circle(center = [0, 0], radius = 4.09, tag = $seg01)
  |> extrude(length = 5)

// Delete the face at index 2
// (the top face)
deleteFace(cylinder, faces = [faceId(cylinder, index = 2)])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the faceId function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-faceId0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-faceId0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


