---
title: "fillet"
subtitle: "Function in std::solid"
excerpt: "Blend a transitional edge along a tagged path, smoothing the sharp edge."
layout: manual
---

Blend a transitional edge along a tagged path, smoothing the sharp edge.

```kcl
fillet(
  @solid: Solid,
  radius: number(Length),
  tags: [Edge; 1+],
  tolerance?: number(Length),
  tag?: TagDecl,
): Solid
```

Fillet is similar in function and use to a chamfer, except
a chamfer will cut a sharp transition along an edge while fillet
will smoothly blend the transition.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose edges should be filletted | Yes |
| `radius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The radius of the fillet | Yes |
| `tags` | [[`Edge`](/docs/kcl-std/types/std-types-Edge); 1+] | The paths you want to fillet | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this fillet | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
width = 20
length = 10
thickness = 1
filletRadius = 2

mountingPlateSketch = startSketchOn(XY)
  |> startProfile(at = [-width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, -length / 2], tag = $edge1)
  |> line(endAbsolute = [width / 2, length / 2], tag = $edge2)
  |> line(endAbsolute = [-width / 2, length / 2], tag = $edge3)
  |> close(tag = $edge4)

mountingPlate = extrude(mountingPlateSketch, length = thickness)
  |> fillet(
       radius = filletRadius,
       tags = [
         getNextAdjacentEdge(edge1),
         getNextAdjacentEdge(edge2),
         getNextAdjacentEdge(edge3),
         getNextAdjacentEdge(edge4)
       ],
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the fillet function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-fillet0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-fillet0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
width = 20
length = 10
thickness = 1
filletRadius = 1

mountingPlateSketch = startSketchOn(XY)
  |> startProfile(at = [-width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, -length / 2], tag = $edge1)
  |> line(endAbsolute = [width / 2, length / 2], tag = $edge2)
  |> line(endAbsolute = [-width / 2, length / 2], tag = $edge3)
  |> close(tag = $edge4)

mountingPlate = extrude(mountingPlateSketch, length = thickness)
  |> fillet(
       radius = filletRadius,
       tolerance = 0.000001,
       tags = [
         getNextAdjacentEdge(edge1),
         getNextAdjacentEdge(edge2),
         getNextAdjacentEdge(edge3),
         getNextAdjacentEdge(edge4)
       ],
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the fillet function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-fillet1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-fillet1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
@settings(experimentalFeatures = allow)

blockProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 6mm, var 0mm])
  edge2 = line(start = [var 6mm, var 0mm], end = [var 6mm, var 4mm])
  edge3 = line(start = [var 6mm, var 4mm], end = [var 0mm, var 4mm])
  edge4 = line(start = [var 0mm, var 4mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

block = extrude(region(point = [3mm, 2mm], sketch = blockProfile), length = 3, tagEnd = $top)

tabProfile = startSketchOn(block, face = top)
  |> startProfile(at = [1mm, 1mm])
  |> line(end = [4mm, 0mm], tag = $tabEdge)
  |> line(end = [0mm, 1mm])
  |> line(end = [-4mm, 0mm])
  |> close()

blockWithTab = extrude(tabProfile, length = 1mm)
filletedBlock = fillet(blockWithTab, radius = 0.5mm, tags = [getNextAdjacentEdge(tabEdge)])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the fillet function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-fillet2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-fillet2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


