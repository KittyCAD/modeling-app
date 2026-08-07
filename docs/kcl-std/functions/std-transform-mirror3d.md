---
title: "mirror3d"
subtitle: "Function in std::transform"
excerpt: "Create a mirror image of a 3D solid/surface/body, across some specified mirror axis."
layout: manual
---

Create a mirror image of a 3D solid/surface/body, across some specified mirror axis.

```kcl
mirror3d(
  @bodies: [Solid; 1+],
  across: Edge | Plane | Axis3d | Segment | any,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `bodies` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The body or bodies to be reflected. | Yes |
| `across` | [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) or [`Segment`](/docs/kcl-std/types/std-types-Segment) or [`any`](/docs/kcl-std/types/std-types-any) | The axis (or other geometry) to reflect across. An edge specifier object such as `{ sideFaces = [faceTag1, faceTag2] }` can identify a solid edge without using its UUID. | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
// Simple mirror3d example, showing mirroring across named axes.
@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  line3 = line(start = [var -4.59mm, var -5.11mm], end = [var -5mm, var 3.51mm])
  arc1 = arc(start = [var -4.69mm, var -3.99mm], end = [var -6.48mm, var 0mm], center = [var -5.13mm, var -1.79mm])
  horizontal([arc1.end, ORIGIN])
}

hidden001 = hide(sketch001)
region001 = region(point = [-4.7462511mm, -1.7722965mm], sketch = sketch001)
mySolid = extrude(region001, length = 1)
  |> translate(z = 1)

mySolid2 = mirror3d([mySolid], across = YZ)
mirror3d([mySolid, mySolid2], across = XY)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror3d0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror3d0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Similar mirror example, but showing mirroring across an arbitrary plane.
@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  line3 = line(start = [var -4.59mm, var -5.11mm], end = [var -5mm, var 3.51mm])
  arc1 = arc(start = [var -4.69mm, var -3.99mm], end = [var -6.48mm, var 0mm], center = [var -5.13mm, var -1.79mm])
  horizontal([arc1.end, ORIGIN])
}

hidden001 = hide(sketch001)
region001 = region(point = [-4.7462511mm, -1.7722965mm], sketch = sketch001)
shape1 = extrude(region001, length = 1)
  |> translate(z = 1)

customPlane = {
  origin = { x = 0, y = 1, z = 0 },
  xAxis = { x = 1, y = 1, z = 0 },
  yAxis = { x = 0, y = 0, z = 1 }
}
shape2 = mirror3d([shape1], across = customPlane)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror3d1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror3d1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Example of mirroring across segments.
@settings(kclVersion = 2.0)

sketch001 = sketch(on = XY) {
  line3 = line(start = [var -4.59mm, var -5.11mm], end = [var -5mm, var 3.51mm])
  arc1 = arc(start = [var -4.69mm, var -3.99mm], end = [var -6.48mm, var 0mm], center = [var -5.13mm, var -1.79mm])
  horizontal([arc1.end, ORIGIN])
  axisLine = line(start = [var -6.01mm, var 3.21mm], end = [var 1.85mm, var -3.13mm])
}

hidden001 = hide(sketch001)
region001 = region(point = [-4.7462511mm, -1.7722965mm], sketch = sketch001)
shape1 = extrude(region001, length = 1)
  |> translate(z = 1)

shape2 = mirror3d([shape1], across = sketch001.axisLine)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror3d2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror3d2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Mirror geometry across the edge of some other geometry.
@settings(kclVersion = 2.0)

// Sketch the solid to mirror.
sketch001 = sketch(on = XY) {
  line3 = line(start = [var -4.59mm, var -5.11mm], end = [var -5mm, var 3.51mm])
  arc1 = arc(start = [var -4.69mm, var -3.99mm], end = [var -6.48mm, var 0mm], center = [var -5.13mm, var -1.79mm])
  horizontal([arc1.end, ORIGIN])
  axisLine = line(start = [var -6.01mm, var 3.21mm], end = [var 1.85mm, var -3.13mm])
}

region001 = region(point = [-4.7462511mm, -1.7722965mm], sketch = sketch001)
shape1 = extrude(region001, length = 1)
  |> translate(z = 1)

// Sketch the solid which will be mirrored across.
sketch002 = sketch(on = XY) {
  line1 = line(start = [var -1.43mm, var 1.01mm], end = [var 1.85mm, var 1.01mm])
  line2 = line(start = [var 1.85mm, var 1.01mm], end = [var 1.85mm, var -1.34mm])
  line3 = line(start = [var 1.85mm, var -1.34mm], end = [var -1.43mm, var -1.34mm])
  line4 = line(start = [var -1.43mm, var -1.34mm], end = [var -1.43mm, var 1.01mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
}
hidden002 = hide(sketch002)
region002 = region(point = [0.21mm, 1.0075mm], sketch = sketch002)
extrude001 = extrude(region002, length = 1, tagEnd = $capEnd001)

// Do the mirroring, across an edge of some solid.
shape2 = mirror3d(
  [shape1],
  across = {
    sideFaces = [region002.tags.line1, capEnd001]
  },
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror3d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror3d3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror3d3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


