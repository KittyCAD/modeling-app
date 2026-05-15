---
title: "hollow"
subtitle: "Function in std::solid"
excerpt: "Make the inside of a 3D object hollow."
layout: manual
---

Make the inside of a 3D object hollow.

```kcl
hollow(
  @solid: Solid,
  thickness: number(Length),
): Solid
```

Remove volume from a 3-dimensional shape such that a wall of the
provided thickness remains around the exterior of the shape.
By default, it'll look visually the same, but you can see the difference
if you use `appearance` to make it transparent, or cut it open with
a `subtract`.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Which solid to hollow out | Yes |
| `thickness` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The thickness of the remaining shell | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Make two cubes, utterly identical,
// except that one (left) is hollowed out,
// and the other one (right) isn't.
width = 2
solidCube = startSketchOn(-XZ)
  |> startProfile(at = [-width, width])
  |> line(end = [width, 0])
  |> line(end = [0, -width])
  |> line(end = [-width, 0])
  |> close()
  |> extrude(length = width, symmetric = true)

hollowCube = clone(solidCube)
  |> hollow(thickness = 0.25)
  |> translate(x = width * 1.1)

// Make a tool that spans the top half of both cubes,
// so we can cut open the cubes and look at their insides.
tool = startSketchOn(offsetPlane(XY, offset = width))
  |> startProfile(at = [0, width])
  |> line(end = [width * 3, 0])
  |> line(end = [0, -width * 2])
  |> line(end = [-width * 3, 0])
  |> close()
  |> extrude(length = width, symmetric = true)
subtract([solidCube, hollowCube], tools = tool)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hollow function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-hollow0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-hollow0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Hollow a sketch on face object.
size = 100
case = startSketchOn(-XZ)
  |> startProfile(at = [-size, -size])
  |> line(end = [2 * size, 0])
  |> line(end = [0, 2 * size])
  |> tangentialArc(endAbsolute = [-size, size])
  |> close()
  |> extrude(length = 65)

thing1 = startSketchOn(case, face = END)
  |> circle(center = [-size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

thing2 = startSketchOn(case, face = END)
  |> circle(center = [size / 2, -size / 2], radius = 25)
  |> extrude(length = 50)

hollow(case, thickness = 0.5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hollow function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-hollow1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-hollow1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


