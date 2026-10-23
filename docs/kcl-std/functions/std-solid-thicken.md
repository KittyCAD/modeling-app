---
title: "thicken"
subtitle: "Function in std::solid"
excerpt: "Give a planar/cylindrical surface or a connected straight extrusion of lines and circular arcs a uniform thickness, closing its boundaries into a solid. Tangent joins stay smooth; sharp corners use mitered joins. Set `flip = true` to reverse the direction; `false` (default) follows the surface normal. Thickness is a positive total wall thickness. `center = true` places half on each side, so flipping has no effect when centered. Overlapping offset contours are passed through without a self-intersection check. Other surface types and cut multi-face surfaces are not yet supported. Requires an engine with surface thickening support."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Give a planar/cylindrical surface or a connected straight extrusion of lines and circular arcs a uniform thickness, closing its boundaries into a solid. Tangent joins stay smooth; sharp corners use mitered joins. Set `flip = true` to reverse the direction; `false` (default) follows the surface normal. Thickness is a positive total wall thickness. `center = true` places half on each side, so flipping has no effect when centered. Overlapping offset contours are passed through without a self-intersection check. Other surface types and cut multi-face surfaces are not yet supported. Requires an engine with surface thickening support.

```kcl
thicken(
  @surface: Solid,
  thickness: number(Length),
  flip?: bool,
  center?: bool,
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `surface` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The surface body to thicken. | Yes |
| `thickness` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Positive total wall thickness. | Yes |
| `flip` | [`bool`](/docs/kcl-std/types/std-types-bool) | Reverse the direction of thickening. Has no effect when centered. | No |
| `center` | [`bool`](/docs/kcl-std/types/std-types-bool) | Place half the total thickness on each side of the surface. | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 3.0, experimentalFeatures = allow)

profile = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 20mm, var 0mm])
  arc1 = arc(start = [var 20mm, var 0mm], end = [var 30mm, var 10mm], center = [var 20mm, var 10mm])
  line2 = line(start = [var 30mm, var 10mm], end = [var 30mm, var 25mm])
  line3 = line(start = [var 30mm, var 25mm], end = [var 45mm, var 25mm])
}
surface = extrude(
  [
    profile.line1,
    profile.arc1,
    profile.line2,
    profile.line3
  ],
  length = 10mm,
  bodyType = SURFACE,
)
body = thicken(surface, thickness = 2mm, center = true)

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


