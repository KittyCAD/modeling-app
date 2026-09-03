---
title: "sprocket::rollerChain"
subtitle: "Function in std::sprocket"
excerpt: "Create an approximate roller-chain sprocket plate with a central bore and lightening holes."
layout: manual
---

Create an approximate roller-chain sprocket plate with a central bore and lightening holes.

```kcl
sprocket::rollerChain(
  nTeeth: number(_),
  chainPitch: number(Length),
  rollerWidth: number(Length),
  rollerDiameter: number(Length),
  bore: number(Length),
): Solid
```

The sprocket is centered at the origin on the XZ plane and its thickness is
symmetric about that plane. Use `translate()` and `rotate()` to position it.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `nTeeth` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Number of teeth. Must be a whole number of at least three. | Yes |
| `chainPitch` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Distance between adjacent chain-pin centers. | Yes |
| `rollerWidth` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Internal width of the roller chain. The sprocket is 90 percent of this width. | Yes |
| `rollerDiameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Diameter of the chain roller. | Yes |
| `bore` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Diameter of the central shaft bore. | Yes |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// A 24-tooth sprocket for ANSI #25 roller chain.
@settings(defaultLengthUnit = in, kclVersion = 1.0)

sprocket::rollerChain(
  nTeeth = 24,
  chainPitch = 0.25in,
  rollerWidth = 0.125in,
  rollerDiameter = 0.13in,
  bore = 0.625in,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sprocket::rollerChain function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sprocket-rollerChain0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sprocket-rollerChain0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>
