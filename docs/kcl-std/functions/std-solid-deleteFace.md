---
title: "deleteFace"
subtitle: "Function in std::solid"
excerpt: "Delete a face, by its index (number). For pure KCL users, these IDs are difficult to guess."
layout: manual
---

Delete a face, by its index (number). For pure KCL users, these IDs are difficult to guess.

```kcl
deleteFace(
  @val: body,
  faceIndices: [number(_); 1+],
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `val` | `body` | Target to delete a surface from. | Yes |
| `faceIndices` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 1+] | Face to delete. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
startSketchOn(XY)
  |> polygon(radius = 10, numSides = 4, center = [0, 0])
  |> extrude(length = 2)
  |> deleteFace(faceIndices = [0, 5])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the deleteFace function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-deleteFace0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-deleteFace0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


