---
title: "hyperbolicPoint"
subtitle: "Function in std::sketch"
excerpt: "Calculate the point (x, y) on a hyperbola given x or y and the semi major/minor values of the hyperbolic."
layout: manual
---

Calculate the point (x, y) on a hyperbola given x or y and the semi major/minor values of the hyperbolic.

```kcl
hyperbolicPoint(
  semiMajor: number,
  semiMinor: number,
  x?: number(Length),
  y?: number(Length),
): Point2d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `semiMajor` | [`number`](/docs/kcl-std/types/std-types-number) | The semi major value, a, of the hyperbolic equation x^2 / a ^ 2 - y^2 / b^2 = 1. | Yes |
| `semiMinor` | [`number`](/docs/kcl-std/types/std-types-number) | The semi minor value, b, of the hyperbolic equation x^2 / a ^ 2 - y^2 / b^2 = 1. | Yes |
| `x` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The x value. Calculates y and returns (x, y). Incompatible with `y`. | No |
| `y` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The y value. Calculates x and returns (x, y). Incompatible with `x`. | No |

### Returns

[`Point2d`](/docs/kcl-std/types/std-types-Point2d) - A point in two dimensional space.


### Examples

```kcl
point = hyperbolicPoint(x = 5, semiMajor = 2, semiMinor = 1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the hyperbolicPoint function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-hyperbolicPoint0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-hyperbolicPoint0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


