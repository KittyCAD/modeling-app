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
  tag?: TagDecl,
): Solid
```

Chamfer is similar in function and use to a fillet, except
a fillet will blend the transition along an edge, rather than cut
a sharp, straight transitional edge.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose edges should be chamfered | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The length of the chamfer | Yes |
| `tags` | [`[Edge; 1+]`](/docs/kcl-std/types/std-types-Edge) | The paths you want to chamfer | Yes |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this chamfer | No |

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


