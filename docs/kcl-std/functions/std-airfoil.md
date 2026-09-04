---
title: "airfoil"
subtitle: "Function in std"
excerpt: "Create a closed NACA four-digit airfoil profile from a numeric designation."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Create a closed NACA four-digit airfoil profile from a numeric designation.

```kcl
airfoil(
  sketchPlane: Plane,
  chordLength: number(Length),
  naca4Code: number(_),
): Sketch
```

The first digit is maximum camber as a percentage of the chord, the second digit
is the position of maximum camber in tenths of the chord, and the final two digits
are maximum thickness as a percentage of the chord. For example, `2414` describes
2 percent camber at 40 percent chord with 14 percent thickness. Leading zeroes on
symmetric designations may be omitted, so NACA 0012 is passed as `12`.

The profile uses tangent biarcs to approximate the NACA surface. It uses `-0.1036`
as the final thickness coefficient so the tapered trailing edge closes, producing
a watertight profile suitable for `region`, `extrude`, and `loft`.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketchPlane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | Plane on which to create the profile. The leading edge starts at the plane origin and the chord follows its positive X axis. | Yes |
| `chordLength` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance from the leading edge to the trailing edge. | Yes |
| `naca4Code` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Numeric four-digit NACA designation. Leading zeroes may be omitted. | Yes |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

naca2414 = airfoil(sketchPlane = YZ, chordLength = 1m, naca4Code = 2414)

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


