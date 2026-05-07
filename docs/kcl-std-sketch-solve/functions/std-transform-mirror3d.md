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
  across: Edge | Plane | Axis3d | Segment,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `bodies` | `[Solid; 1+]` | The body or bodies to be reflected. | Yes |
| `across` | `Edge | Plane | Axis3d | Segment` | The axis (or other geometry) to reflect across. | Yes |

### Returns

`[Solid; 1+]`


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


