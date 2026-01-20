---
title: "is_solid"
subtitle: "Function in std::solid"
excerpt: "Given a KCL value, returns `true` if the value is a solid and `false` otherwise."
layout: manual
---

Given a KCL value, returns `true` if the value is a solid and `false` otherwise.

```kcl
is_solid(@val: any): bool
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `val` | [`any`](/docs/kcl-std/types/std-types-any) | Value to check if it is a solid or not | Yes |

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

assertIs(is_solid(cube))
assertIs(is_surface(openBoxSurface))

// surface is not a solid
assertIs(!is_solid(openBoxSurface))

// solid is not a surface
assertIs(!is_surface(cube))

// other values are neither solids nor surfaces
assertIs(!is_solid("aaa"))
assertIs(!is_surface("aaa"))

assertIs(!is_solid(2in))
assertIs(!is_surface(2in))

assertIs(!is_solid(true))
assertIs(!is_surface(false))

assertIs(!is_solid(25deg))
assertIs(!is_surface(25deg))

assertIs(!is_solid([1, 2]))
assertIs(!is_surface([1, 2]))

assertIs(!is_solid([1, 2, 3]))
assertIs(!is_surface([1, 2, 3]))

assertIs(!is_solid(XY))
assertIs(!is_surface(XY))

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the is_solid function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-is_solid0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-is_solid0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


