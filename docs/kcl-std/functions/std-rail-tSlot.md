---
title: "rail::tSlot"
subtitle: "Function in std::rail"
excerpt: "Create a square T-slotted framing rail with four symmetric side slots and a central bore."
layout: manual
---

Create a square T-slotted framing rail with four symmetric side slots and a central bore.

```kcl
rail::tSlot(
  railHeight: number(Length),
  length: number(Length),
): Solid
```

The profile uses standard one-inch proportions and scales uniformly to `railHeight`.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `railHeight` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Overall width and height of the square rail profile. | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Extrusion length of the rail. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
@settings(defaultLengthUnit = in, kclVersion = 1.0)

rail::tSlot(railHeight = 1.5in, length = 2ft)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the rail::tSlot function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-rail-tSlot0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-rail-tSlot0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>
