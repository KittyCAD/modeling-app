---
title: "thicken"
subtitle: "Function in std::solid"
excerpt: "Give a single planar or cylindrical surface face a uniform thickness, closing its boundaries to create a solid. Boundaries and holes are preserved. Positive thickness follows the surface normal; negative thickness reverses it. Joined surfaces and other curved surface types are not yet supported. Requires an engine with surface thickening support."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Give a single planar or cylindrical surface face a uniform thickness, closing its boundaries to create a solid. Boundaries and holes are preserved. Positive thickness follows the surface normal; negative thickness reverses it. Joined surfaces and other curved surface types are not yet supported. Requires an engine with surface thickening support.

```kcl
thicken(
  @surface: Solid,
  thickness: number(Length),
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `surface` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The single-face surface to thicken. | Yes |
| `thickness` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Signed thickness measured along the surface normal. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 3.0, experimentalFeatures = allow)

profile = sketch(on = XY) {
  edge = line(start = [var 0mm, var 0mm], end = [var 20mm, var 0mm])
}
surface = extrude(profile.edge, length = 10mm, bodyType = SURFACE)
plate = thicken(surface, thickness = 2mm)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the thicken function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-thicken0_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-thicken0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


