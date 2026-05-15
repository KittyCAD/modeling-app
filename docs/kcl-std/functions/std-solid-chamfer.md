---
title: "chamfer"
subtitle: "Function in std::solid"
excerpt: "Cut a straight transitional edge along a tagged path."
layout: manual
---

Cut a straight transitional edge along a tagged path.

```kcl
chamfer(
  @solid: Solid,
  length: number(Length),
  tags: [Edge; 1+],
  secondLength?: number(Length),
  angle?: number(Angle),
  tag?: TagDecl,
  legacyMethod?: bool,
): Solid
```

Chamfer is similar in function and use to a fillet, except
a fillet will blend the transition along an edge, rather than cut
a sharp, straight transitional edge.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose edges should be chamfered | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Chamfering cuts away two faces to create a third face. This is the length to chamfer away from each face. The larger this length to chamfer away, the larger the new face will be. | Yes |
| `tags` | [[`Edge`](/docs/kcl-std/types/std-types-Edge); 1+] | The paths you want to chamfer | Yes |
| `secondLength` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Chamfering cuts away two faces to create a third face. If this argument isn't given, the lengths chamfered away from both the first and second face are both given by `length`. If this argument _is_ given, it determines how much is cut away from the second face. Incompatible with `angle`. | No |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Chamfering cuts away two faces to create a third face. This argument determines the angle between the two cut edges. Requires `length`, incompatible with `secondLength`. The valid range is 0deg < angle < 90deg. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this chamfer | No |
| `legacyMethod` | [`bool`](/docs/kcl-std/types/std-types-bool) | **Deprecated as of KCL 2.0.** You probably shouldn't set this or care about this, it's for opting back into an older version of an engine algorithm. If true, revert to older engine SSI algorithm. Defaults to false. | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Chamfer a mounting plate.
width = 20
length = 10
thickness = 1
chamferLength = 2

mountingPlateSketch = startSketchOn(XY)
  |> startProfile(at = [-width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, -length / 2], tag = $edge1)
  |> line(endAbsolute = [width / 2, length / 2], tag = $edge2)
  |> line(endAbsolute = [-width / 2, length / 2], tag = $edge3)
  |> close(tag = $edge4)

mountingPlate = extrude(mountingPlateSketch, length = thickness)
  |> chamfer(
       length = chamferLength,
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
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch on the face of a chamfer.
fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

part001 = cube(pos = [0, 0], scale = 20)
  |> close(tag = $line1)
  |> extrude(length = 20)
  // We tag the chamfer to reference it later.
  |> chamfer(length = 10, tags = [getOppositeEdge(line1)], tag = $chamfer1)

sketch001 = startSketchOn(part001, face = chamfer1)
  |> startProfile(at = [10, 10])
  |> line(end = [2, 0])
  |> line(end = [0, 2])
  |> line(end = [-2, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Specify a custom chamfer angle.
fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

part001 = cube(pos = [0, 0], scale = 20)
  |> close(tag = $line1)
  |> extrude(length = 20)
  |> chamfer(length = 10, angle = 30deg, tags = [getOppositeEdge(line1)])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
baseProfile = sketch(on = XY) {
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

block = extrude(region(point = [3mm, 2mm], sketch = baseProfile), length = 3mm, tagEnd = $top)

tabProfile = startSketchOn(block, face = top)
  |> startProfile(at = [1mm, 1mm])
  |> line(end = [4mm, 0mm], tag = $tabEdge)
  |> line(end = [0mm, 1mm])
  |> line(end = [-4mm, 0mm])
  |> close()

blockWithTab = extrude(tabProfile, length = 1mm)
chamfered = chamfer(blockWithTab, length = 0.5mm, tags = [getNextAdjacentEdge(tabEdge)])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


