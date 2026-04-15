---
title: "startSketchOn"
subtitle: "Function in std::sketch"
excerpt: "Start a new 2-dimensional sketch on a specific plane or face."
layout: manual
---

Start a new 2-dimensional sketch on a specific plane or face.

```kcl
startSketchOn(
  @planeOrSolid: Solid | Plane,
  face?: TaggedFace | Segment,
  normalToFace?: TaggedFace | Segment,
  alignAxis?: Axis2d,
  normalOffset?: number(Length),
): Plane | Face
```

This is part of sketch v1 and is soft deprecated in favor of
[sketch-solve](/docs/kcl-std/modules/std-solver).

### Sketch on Face Behavior

There are some important behaviors to understand when sketching on a face:

The resulting sketch will _include_ the face and thus Solid
that was sketched on. So say you were to export the resulting Sketch / Solid
from a sketch on a face, you would get both the artifact of the sketch
on the face and the parent face / Solid itself.

This is important to understand because if you were to then sketch on the
resulting Solid, it would again include the face and parent Solid that was
sketched on. This could go on indefinitely.

The point is if you want to export the result of a sketch on a face, you
only need to export the final Solid that was created from the sketch on the
face, since it will include all the parent faces and Solids.

See [sketch on face](/docs/kcl-lang/sketch-on-face) for more details.

### Multiple Profiles

When creating multiple profiles in a sketch, each profile must be made
separately and assigned to a variable. Using one pipeline to create multiple
profiles, where one profile is piped into the next, is not currently
supported.

```js
// This does NOT work.
twoSquares = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
  |> startProfile(at = [20, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
twoCubes = extrude(twoSquares, length = 10)
```

Instead, use separate pipelines, and extrude an array of them all.

```js
sketch1 = startSketchOn(XY)
squareProfile1 = startProfile(sketch1, at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
squareProfile2 = startProfile(sketch1, at = [20, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> line(end = [-10, 0])
  |> close()
twoCubes = extrude([squareProfile1, squareProfile2], length = 10)
```

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `planeOrSolid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) or [`Plane`](/docs/kcl-std/types/std-types-Plane) | Profile whose start is being used. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | Identify a face of a solid if a solid is specified as the input argument (`planeOrSolid`). Incompatible with `normalToFace`. | No |
| `normalToFace` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | Identify a face of a solid if a solid is specified as the input argument. Starts a sketch on the plane orthogonal to this specified face. Incompatible with `face`, requires `alignAxis`. | No |
| `alignAxis` | [`Axis2d`](/docs/kcl-std/types/std-types-Axis2d) | If sketching normal to face, this axis will be the new local x axis of the sketch plane. The selected face's normal will be the local y axis. Incompatible with `face`, requires `normalToFace`. | No |
| `normalOffset` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Offset the sketch plane along its normal by the given amount. Incompatible with `face`, requires `normalToFace`. | No |

### Returns

[`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Face`](/docs/kcl-std/types/std-types-Face)


### Examples

```kcl
baseProfile = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 6mm, var 0mm])
  line2 = line(start = [var 6mm, var 0mm], end = [var 6mm, var 4mm])
  line3 = line(start = [var 6mm, var 4mm], end = [var 0mm, var 4mm])
  line4 = line(start = [var 0mm, var 4mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  horizontal(line1)
  vertical(line2)
  horizontal(line3)
  vertical(line4)
}

baseRegion = region(point = [3mm, 2mm], sketch = baseProfile)
block = extrude(baseRegion, length = 4mm, tagEnd = $top)

sideSketch = startSketchOn(block, face = top)
  |> startProfile(at = [0.5mm, 0.5mm])
  |> line(end = [2mm, 0mm])
  |> line(end = [0mm, 1mm])
  |> line(end = [-2mm, 0mm])
  |> close()

tower = extrude(sideSketch, length = 1mm)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the startSketchOn function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-startSketchOn7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-startSketchOn7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


