---
title: "shell"
subtitle: "Function in std::solid"
excerpt: "Remove volume from a 3-dimensional shape such that a wall of the provided thickness remains, taking volume starting at the provided face, leaving it open in that direction."
layout: manual
---

Remove volume from a 3-dimensional shape such that a wall of the provided thickness remains, taking volume starting at the provided face, leaving it open in that direction.

```kcl
shell(
  @solids: [Solid; 1+],
  thickness: number(Length),
  faces: [TaggedFace; 1+],
): [Solid]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | Which solid (or solids) to shell out | Yes |
| `thickness` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The thickness of the shell | Yes |
| `faces` | [[`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace); 1+] | The faces you want removed | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid)]


### Examples

```kcl
boxProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 6mm, var 0mm])
  edge2 = line(start = [var 6mm, var 0mm], end = [var 6mm, var 4mm])
  edge3 = line(start = [var 6mm, var 4mm], end = [var 0mm, var 4mm])
  edge4 = line(start = [var 0mm, var 4mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

box = extrude(region(point = [3mm, 2mm], sketch = boxProfile), length = 4mm)
openBox = shell(box, faces = [END], thickness = 0.5mm)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the shell function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-shell7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-shell7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


