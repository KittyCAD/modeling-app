---
title: "translate"
subtitle: "Function in std::transform"
excerpt: "Move a solid or a sketch."
layout: manual
---

Move a solid or a sketch.

```kcl
translate(
  @objects: [Solid; 1+] | [Sketch; 1+] | ImportedGeometry,
  x?: number(Length),
  y?: number(Length),
  z?: number(Length),
  global?: bool,
  xyz?: [number(Length); 3],
): [Solid; 1+] | [Sketch; 1+] | ImportedGeometry
```

This is really useful for assembling parts together. You can create a part
and then move it to the correct location.

By default, this does a local translation, around the sketch/body's coordinate system.
To translate around the global scene coordinate system, use `global = true`.

Translate is really useful for sketches if you want to move a sketch
and then rotate it using the `rotate` function to create a loft.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `objects` | `[Solid; 1+] | [Sketch; 1+] | ImportedGeometry` | The solid, sketch, or set of solids or sketches to move. | Yes |
| `x` | `number(Length)` | The amount to move the solid or sketch along the x axis. | No |
| `y` | `number(Length)` | The amount to move the solid or sketch along the y axis. | No |
| `z` | `number(Length)` | The amount to move the solid or sketch along the z axis. | No |
| `global` | `bool` | If true, the transform is applied in global space. The origin of the model will move. By default, the transform is applied in local sketch axis, therefore the origin will not move. | No |
| `xyz` | `[number(Length); 3]` | If given, interpret this point as 3 distances, along each of [X, Y, Z] and translate by each of them. | No |

### Returns

`[Solid; 1+] | [Sketch; 1+] | ImportedGeometry`



