---
title: "offsetPlane"
subtitle: "Function in std"
excerpt: "Offset a plane by a distance along its normal."
layout: manual
---

Offset a plane by a distance along its normal.

```kcl
offsetPlane(
  @plane: Plane,
  offset: number(Length),
): Plane
```

For example, if you offset the `XZ` plane by 10, the new plane will be parallel to the `XZ`
plane and 10 units away from it.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `plane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | The plane (e.g. `XY`) which this new plane is created from. | Yes |
| `offset` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance from the standard plane this new plane will be created at. | Yes |

### Returns

[`Plane`](/docs/kcl-std/types/std-types-Plane) - An abstract plane.


### Examples

```kcl
// Loft a square and a circle on the `XY` plane using offset.
squareSketch = startSketchOn(XY)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch = startSketchOn(offsetPlane(XY, offset = 150))
  |> circle(center = [0, 100], radius = 50)

loft([squareSketch, circleSketch])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the offsetPlane function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-offsetPlane0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-offsetPlane0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Loft a square and a circle on the `XZ` plane using offset.
squareSketch = startSketchOn(XZ)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch = startSketchOn(offsetPlane(XZ, offset = 150))
  |> circle(center = [0, 100], radius = 50)

loft([squareSketch, circleSketch])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the offsetPlane function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-offsetPlane1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-offsetPlane1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Loft a square and a circle on the `YZ` plane using offset.
squareSketch = startSketchOn(YZ)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch = startSketchOn(offsetPlane(YZ, offset = 150))
  |> circle(center = [0, 100], radius = 50)

loft([squareSketch, circleSketch])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the offsetPlane function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-offsetPlane2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-offsetPlane2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Loft a square and a circle on the `-XZ` plane using offset.
squareSketch = startSketchOn(-XZ)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch = startSketchOn(offsetPlane(-XZ, offset = 150))
  |> circle(center = [0, 100], radius = 50)

loft([squareSketch, circleSketch])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the offsetPlane function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-offsetPlane3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-offsetPlane3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// A circle on the XY plane
startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> circle(radius = 10, center = [0, 0])

// Triangle on the plane 4 units above
startSketchOn(offsetPlane(XY, offset = 4))
  |> startProfile(at = [0, 0])
  |> line(end = [10, 0])
  |> line(end = [0, 10])
  |> close()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the offsetPlane function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-offsetPlane4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-offsetPlane4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


