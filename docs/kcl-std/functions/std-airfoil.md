---
title: "airfoil"
subtitle: "Function in std"
excerpt: "Create a closed NACA four-digit airfoil profile from its digit-derived percentages."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a closed NACA four-digit airfoil profile from its digit-derived percentages.

```kcl
airfoil(
  sketchPlane: Plane,
  chordLength: number(Length),
  maxCamberPercent: number(_),
  camberPositionPercent: number(_),
  thicknessPercent: number(_),
): Sketch
```

The first NACA digit is `maxCamberPercent`, the second digit multiplied by ten is
`camberPositionPercent`, and the final two digits are `thicknessPercent`. For example,
a NACA 2412 airfoil uses `2`, `40`, and `12`, respectively.

The profile uses circular arcs to approximate the NACA surface coordinates. It uses
`-0.1036` as the final thickness coefficient so the trailing edge closes, producing a
watertight profile suitable for `region`, `extrude`, and `loft`. Nearly collinear
samples use a straight span instead of an unstable, extremely large-radius arc.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchPlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | Plane on which to create the profile. The leading edge starts at the plane origin and the chord follows its positive X axis. | Yes |
| `chordLength` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance from the leading edge to the trailing edge. | Yes |
| `maxCamberPercent` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Maximum camber as a percentage of the chord. This is the first NACA digit. | Yes |
| `camberPositionPercent` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Chordwise position of maximum camber as a percentage of the chord. This is ten times the second NACA digit. | Yes |
| `thicknessPercent` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Maximum thickness as a percentage of the chord. This is the final two NACA digits. | Yes |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0, experimentalFeatures = allow)

naca2412 = airfoil(
  sketchPlane = XY,
  chordLength = 100mm,
  maxCamberPercent = 2,
  camberPositionPercent = 40,
  thicknessPercent = 12,
)
airfoilRegion = region(point = [50mm, 0mm], sketch = naca2412)
wingSection = extrude(airfoilRegion, length = 10mm)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the airfoil function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-airfoil0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-airfoil0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


