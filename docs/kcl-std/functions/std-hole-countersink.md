---
title: "hole::countersink"
subtitle: "Function in std::hole"
excerpt: "Cut an angled countersink at the top of the hole. Typically used when a conical screw head has to sit flush with or below the surface being cut into."
layout: manual
---

Cut an angled countersink at the top of the hole. Typically used when a conical screw head has to sit flush with or below the surface being cut into.

```kcl
hole::countersink(
  diameter: number(Length),
  angle: number(Angle),
  headClearance?: number(Length),
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `diameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `headClearance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | No |


### Examples

```kcl
// Model a cube
cubeLen = 20
bigCube = startSketchOn(XY)
  |> startProfile(at = [-cubeLen / 2, -cubeLen / 2 + 10])
  |> line(end = [cubeLen, 0], tag = $a)
  |> line(end = [0, cubeLen], tag = $b)
  |> line(end = [-cubeLen, 0], tag = $c)
  |> line(end = [0, -cubeLen], tag = $d)
  |> close()
  |> extrude(length = cubeLen, symmetric = true)
  |> translate(x = 5)

// Add a hole to the cube.
// It'll have a drilled end, and a countersink (angled tip at the start).
bigCube
  |> hole::hole(
       face = a,
       cutAt = [0, 5],
       holeBottom = hole::drill(pointAngle = 110deg),
       holeBody = hole::blind(depth = 5, diameter = 8),
       holeType = hole::countersink(diameter = 14, angle = 100deg),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::countersink function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-countersink0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-countersink0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Model a cube.
cubeProfile = sketch(on = XY) {
  line1 = line(start = [var -1.5mm, var -1.5mm], end = [var 1.5mm, var -1.5mm])
  line2 = line(start = [var 1.5mm, var -1.5mm], end = [var 1.5mm, var 1.5mm])
  line3 = line(start = [var 1.5mm, var 1.5mm], end = [var -1.5mm, var 1.5mm])
  line4 = line(start = [var -1.5mm, var 1.5mm], end = [var -1.5mm, var -1.5mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  equalLength([line2, line3])
  distance([line2.start, line2.end]) == 3mm
}
cubeRegion = region(point = [0mm, 0mm], sketch = cubeProfile)
cube1 = extrude(cubeRegion, length = 3mm)

// Add a hole to the cube.
// It'll have a drilled end and a countersink (angled tip at the start).
cube1
  |> hole::hole(
       face = cubeRegion.tags.line1,
       cutAt = [1.5, 0],
       holeBottom = hole::drill(pointAngle = 110deg),
       holeBody = hole::blind(depth = 2mm, diameter = 1mm),
       holeType = hole::countersink(diameter = 2mm, angle = 100deg),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::countersink function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-countersink1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-countersink1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Model a cube
cubeLen = 20
bigCube = startSketchOn(XY)
  |> startProfile(at = [-cubeLen / 2, -cubeLen / 2 + 10])
  |> line(end = [cubeLen, 0], tag = $a)
  |> line(end = [0, cubeLen], tag = $b)
  |> line(end = [-cubeLen, 0], tag = $c)
  |> line(end = [0, -cubeLen], tag = $d)
  |> close()
  |> extrude(length = cubeLen, symmetric = true)
  |> translate(x = 5)

// Add a hole to the cube.
// It'll have a drilled end and a recessed countersink.
bigCube
  |> hole::hole(
       face = a,
       cutAt = [0, 5],
       holeBottom = hole::drill(pointAngle = 110deg),
       holeBody = hole::blind(depth = 5, diameter = 8),
       holeType = hole::countersink(diameter = 14, angle = 100deg, headClearance = 3mm),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::countersink function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-countersink2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-countersink2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Model a cube.
cubeProfile = sketch(on = XY) {
  line1 = line(start = [var -1.5mm, var -1.5mm], end = [var 1.5mm, var -1.5mm])
  line2 = line(start = [var 1.5mm, var -1.5mm], end = [var 1.5mm, var 1.5mm])
  line3 = line(start = [var 1.5mm, var 1.5mm], end = [var -1.5mm, var 1.5mm])
  line4 = line(start = [var -1.5mm, var 1.5mm], end = [var -1.5mm, var -1.5mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  equalLength([line2, line3])
  distance([line2.start, line2.end]) == 3mm
}
cubeRegion = region(point = [0mm, 0mm], sketch = cubeProfile)
cube1 = extrude(cubeRegion, length = 3mm)

// Add a hole to the cube.
// It'll have a drilled end and a recessed countersink.
cube1
  |> hole::hole(
       face = cubeRegion.tags.line1,
       cutAt = [1.5, 0],
       holeBottom = hole::drill(pointAngle = 110deg),
       holeBody = hole::blind(depth = 1mm, diameter = 1mm),
       holeType = hole::countersink(diameter = 2mm, angle = 100deg, headClearance = 1mm),
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hole::countersink function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-hole-countersink3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-hole-countersink3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


