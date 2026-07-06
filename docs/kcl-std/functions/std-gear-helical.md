---
title: "gear::helical"
subtitle: "Function in std::gear"
excerpt: "A helical gear (like a spur gear, but the teeth are cut at an angle to the axis)."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

A helical gear (like a spur gear, but the teeth are cut at an angle to the axis).

```kcl
gear::helical(
  nTeeth: number(_),
  module: number(Length),
  pressureAngle: number(Angle),
  helixAngle: number(Angle),
  gearHeight: number(Length),
): Solid
```

The gear will be placed at (0, 0, 0) in the global scene, and extruded up the Z axis.
Use `translate()` and `rotate()` to move it around once it's created.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `nTeeth` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `module` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `pressureAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `helixAngle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `gearHeight` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Basic helical gear example.

@settings(defaultLengthUnit = mm, kclVersion = 1.0, experimentalFeatures = allow)

gearBody = gear::helical(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  helixAngle = 35deg,
  gearHeight = 7,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gear::helical function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gear-helical0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gear-helical0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Gear with a keyhole.

@settings(defaultLengthUnit = mm, kclVersion = 1.0, experimentalFeatures = allow)

// Define the constants of the keyway and the bore hole
keywayWidth = 2
keywayDepth = keywayWidth / 2
holeDiam = 7
holeRadius = holeDiam / 2
startAngle = asin(keywayWidth / 2 / holeRadius)
keyhole = startSketchOn(XY)
  |> startProfile(at = [
       holeRadius * cos(startAngle),
       holeRadius * sin(startAngle)
     ])
  |> xLine(length = keywayDepth)
  |> yLine(length = -keywayWidth)
  |> xLine(length = -keywayDepth)
  |> arc(angleStart = -1 * startAngle + 360deg, angleEnd = 180deg, radius = holeRadius)
  |> arc(angleStart = 180deg, angleEnd = startAngle, radius = holeRadius)
  |> close()

// Create the gear.
gearHeight = 7
gearBody = gear::helical(
  nTeeth = 10,
  module = 2,
  pressureAngle = 20deg,
  helixAngle = 35deg,
  gearHeight,
)
// Create a keyhole solid, then cut it out from the gear
// body to create the final gear with a keyhole.
keyholeSolid = extrude(keyhole, length = gearHeight)
gearWithKeyhole = subtract(gearBody, tools = keyholeSolid)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the gear::helical function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-gear-helical1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-gear-helical1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


