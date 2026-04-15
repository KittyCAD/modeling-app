---
title: "appearance"
subtitle: "Function in std::solid"
excerpt: "Set the appearance of a solid. This only works on solids, not sketches or individual paths."
layout: manual
---

Set the appearance of a solid. This only works on solids, not sketches or individual paths.

```kcl
appearance(
  @solids: [Solid; 1+] | ImportedGeometry,
  color: string,
  metalness?: number(_),
  roughness?: number(_),
  opacity?: number(_),
): [Solid; 1+] | ImportedGeometry
```

This will work on any solid, including extruded solids, revolved solids, and shelled solids.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry) | The The solid(s) whose appearance is being set. | Yes |
| `color` | [`string`](/docs/kcl-std/types/std-types-string) | Color of the new material, a hex string like '#ff0000'. | Yes |
| `metalness` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Metalness of the new material, a percentage like 95.7. | No |
| `roughness` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Roughness of the new material, a percentage like 95.7. | No |
| `opacity` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Opacity. Defaults to 100 (totally opaque). 0 would be totally transparent. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] or [`ImportedGeometry`](/docs/kcl-std/types/std-types-ImportedGeometry)


### Examples

```kcl
// Change the appearance of an imported model.

import "tests/inputs/cube.sldprt" as cube

cube
  |> appearance(color = "#ff0000", metalness = 50, roughness = 50)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-appearance9_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-appearance9.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


