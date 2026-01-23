---
title: "deleteFace"
subtitle: "Function in std::solid"
excerpt: "Delete a face from a body (a solid, or a polysurface)."
layout: manual
---

Delete a face from a body (a solid, or a polysurface).

```kcl
deleteFace(
  @val: Solid,
  faces?: [TaggedFace; 1+],
  faceIndices?: [number(_); 1+],
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `val` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Target to delete a surface from. | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | Face to delete. This is the usual face representation, e.g. a tagged face. | No |
| `faceIndices` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 1+] | Face to delete. The index is a stable ordering of faces, used when you can't get the usual ID (UUID) of a face. | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Make an extruded triangle.
startSketchOn(XY)
  |> startProfile(at = [0, 15])
  |> xLine(length = 10, tag = $a)
  |> yLine(length = 8)
  |> close()
  |> extrude(length = 2)
  // Delete some faces.
  |> deleteFace(faces = [a, END])

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

```kcl
// Make an extruded square.
startSketchOn(XY)
  |> polygon(radius = 10, numSides = 4, center = [0, 0])
  |> extrude(length = 2)
  // Delete some faces. Because there's no tags, we can delete by face _index_.
  |> deleteFace(faceIndices = [0, 5])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the deleteFace function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-deleteFace1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-deleteFace1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


