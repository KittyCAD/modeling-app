---
title: "involuteCircular"
subtitle: "Function in std::sketch"
excerpt: "Extend the current sketch with a new involute circular curve."
layout: manual
---

Extend the current sketch with a new involute circular curve.

```kcl
involuteCircular(
  @sketch: Sketch,
  angle: number(Angle),
  startRadius?: number(Length),
  endRadius?: number(Length),
  startDiameter?: number(Length),
  endDiameter?: number(Length),
  reverse?: bool,
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | The angle to rotate the involute by. A value of zero will produce a curve with a tangent along the x-axis at the start point of the curve. | Yes |
| `startRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The involute is described between two circles, startRadius is the radius of the inner circle. Either `startRadius` or `startDiameter` must be given (but not both). | No |
| `endRadius` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The involute is described between two circles, endRadius is the radius of the outer circle. Either `endRadius` or `endDiameter` must be given (but not both). | No |
| `startDiameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The involute is described between two circles, startDiameter describes the inner circle. Either `startRadius` or `startDiameter` must be given (but not both). | No |
| `endDiameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The involute is described between two circles, endDiameter describes the outer circle. Either `endRadius` or `endDiameter` must be given (but not both). | No |
| `reverse` | [`bool`](/docs/kcl-std/types/std-types-bool) | If reverse is true, the segment will start from the end of the involute, otherwise it will start from that start. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this line. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
a = 10
b = 14
startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> involuteCircular(startRadius = a, endRadius = b, angle = 60deg)
  |> involuteCircular(
       startRadius = a,
       endRadius = b,
       angle = 60deg,
       reverse = true,
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the involuteCircular function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-involuteCircular0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-involuteCircular0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Example: a gear that uses an involute circular profile for the teeth.
@settings(defaultLengthUnit = mm)

/// // Define gear parameters
nTeeth = 21
module = 1.5
pressureAngle = 14deg
gearHeight = 6
pitchDiameter = module * nTeeth
addendum = module
deddendum = 1.25 * module
baseDiameter = pitchDiameter * cos(pressureAngle)
tipDiameter = pitchDiameter + 2 * module

// Using the gear parameters, sketch an involute tooth spanning from the base diameter to the tip diameter
gearSketch = startSketchOn(XY)
  |> startProfile(at = polar(angle = 0, length = baseDiameter / 2))
  |> involuteCircular(
       startDiameter = baseDiameter,
       endDiameter = tipDiameter,
       angle = 0,
       tag = $seg01,
     )
  |> line(endAbsolute = polar(angle = 160deg / nTeeth, length = tipDiameter / 2))
  |> involuteCircular(
       startDiameter = baseDiameter,
       endDiameter = tipDiameter,
       angle = -atan(segEndY(seg01) / segEndX(seg01)) - (180deg / nTeeth),
       reverse = true,
     )
  // Position the end line of the sketch at the start of the next tooth
  |> line(endAbsolute = polar(angle = 360deg / nTeeth, length = baseDiameter / 2))
  // Pattern the sketch about the center by the specified number of teeth, then close the sketch
  |> patternCircular2d(
       instances = nTeeth,
       center = [0, 0],
       arcDegrees = 360deg,
       rotateDuplicates = true,
     )
  |> close()
  // Extrude the gear to the specified height
  |> extrude(length = gearHeight)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the involuteCircular function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-involuteCircular1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-involuteCircular1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


