---
title: "angledLineThatIntersects"
subtitle: "Function in std::sketch"
excerpt: "Draw an angled line from the current origin, constructing a line segment such that the newly created line intersects the desired target line segment."
layout: manual
---

Draw an angled line from the current origin, constructing a line segment such that the newly created line intersects the desired target line segment.

```kcl
angledLineThatIntersects(
  @sketch: Sketch,
  angle: number(Angle),
  intersectTag: TaggedEdge,
  offset?: number(Length),
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Which angle should the line be drawn at? | Yes |
| `intersectTag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The tag of the line to intersect with. | Yes |
| `offset` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The offset from the intersecting line. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(endAbsolute = [5, 10])
  |> line(endAbsolute = [-10, 10], tag = $lineToIntersect)
  |> line(endAbsolute = [0, 20])
  |> angledLineThatIntersects(angle = 80deg, intersectTag = lineToIntersect, offset = 10)
  |> close()

example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the angledLineThatIntersects function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-angledLineThatIntersects0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-angledLineThatIntersects0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


