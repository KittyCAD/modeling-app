---
title: "isSolid"
subtitle: "Function in std::solid"
excerpt: "Given a KCL value that is a 'body' (currently typed as [`Solid`](/docs/kcl-std/types/std-types-Solid)), returns `true` if the value is a solid and `false` otherwise."
layout: manual
---

Given a KCL value that is a 'body' (currently typed as [`Solid`](/docs/kcl-std/types/std-types-Solid)), returns `true` if the value is a solid and `false` otherwise.

```kcl
isSolid(@val: Solid): bool
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `val` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | Value to check if it is a solid or not | Yes |

### Returns

[`bool`](/docs/kcl-std/types/std-types-bool) - A boolean value.


### Examples

```kcl
fn square(@plane, origin, side, body_type) {
  return startSketchOn(plane)
    |> startProfile(at = origin)
    |> yLine(length = side)
    |> xLine(length = side)
    |> yLine(length = -side)
    |> xLine(length = -side)
    |> extrude(length = side, bodyType = body_type)
}

originX0Y0 = [0, 0]
originX10Y0 = [10, 0]

cube = square(
  XY,
  origin = originX0Y0,
  side = 5,
  body_type = "solid",
)
openBoxSurface = square(
  XY,
  origin = originX10Y0,
  side = 6,
  body_type = "surface",
)

assertIs(isSolid(cube))
assertIs(isSurface(openBoxSurface))

// surface is not a solid
assertIs(!isSolid(openBoxSurface))

// solid is not a surface
assertIs(!isSurface(cube))

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the isSolid function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-isSolid0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-isSolid0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


