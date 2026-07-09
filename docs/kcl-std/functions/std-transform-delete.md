---
title: "delete"
subtitle: "Function in std::transform"
excerpt: "Deletes something from the scene. Once it's deleted, you can't use it anymore. This means deleting something twice is an error, as is hiding something after you delete it."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Deletes something from the scene. Once it's deleted, you can't use it anymore. This means deleting something twice is an error, as is hiding something after you delete it.

```kcl
delete(@objects: [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry | [GdtAnnotation; 1+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | [Solid; 1+] | [Sketch; 1+] | [Helix; 1+] | ImportedGeometry | [GdtAnnotation; 1+] | The object or objects to delete. | Yes |


### Examples

```kcl
// Basic example, showing deleting something.
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// Make a cylinder
sketch001 = sketch(on = XY) {
  circle1 = circle(start = [var -2mm, var 1mm], center = [var -1mm, var 0.5mm])
}
cylinder = extrude(region(sketch = sketch001, point = sketch001.circle1.center), length = 5)
// Delete it
delete(cylinder)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the delete function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-delete0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-delete0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Example showing how to delete bodies after splitting them.
@settings(kclVersion = 2.0, experimentalFeatures = allow)

// Make a cylinder.
sketch001 = startSketchOn(XY)
profile001 = circle(
  sketch001,
  center = [0, 0],
  radius = 4.09,
  tag = $seg01,
)
cylinder = extrude(profile001, length = 5)

// Make a wedge that splits the cylinder down the middle.
sketch002 = startSketchOn(XY)
profile002 = startProfile(sketch002, at = [0, -4.75])
  |> angledLine(angle = 0deg, length = 2, tag = $a)
  |> angledLine(angle = segAng(a) + 90deg, length = 9.5)
  |> angledLine(angle = segAng(a), length = -segLen(a))
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
wedge = extrude(profile002, length = 15, symmetric = true)

// Split the cylinder down the wedge.
result = split([cylinder], tools = [wedge])

// Delete the left and right split parts.
delete([result[2], result[0]])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the delete function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-delete1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-delete1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>
