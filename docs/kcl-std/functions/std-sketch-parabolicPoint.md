---
title: "parabolicPoint"
subtitle: "Function in std::sketch"
excerpt: "Calculate the point (x, y) on a parabola given x or y and the coefficients [a, b, c] of the parabola."
layout: manual
---

Calculate the point (x, y) on a parabola given x or y and the coefficients [a, b, c] of the parabola.

```kcl
parabolicPoint(
  coefficients: [number; 3],
  x?: number(Length),
  y?: number(Length),
): Point2d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `coefficients` | [[`number`](/docs/kcl-std/types/std-types-number); 3] | The coefficients [a, b, c] of the parabolic equation y = ax^2 + bx + c. | Yes |
| `x` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The x value. Calculates y and returns (x, y). Incompatible with `y`. | No |
| `y` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The y value. Calculates x and returns (x, y). Incompatible with `x`. | No |

### Returns

[`Point2d`](/docs/kcl-std/types/std-types-Point2d) - A point in two dimensional space.


### Examples

```kcl
point001 = parabolicPoint(x = 5, coefficients = [0.1, 0, 0])
point002 = parabolicPoint(y = 2.5, coefficients = [0.1, 0, 0])
assert(point001[0], isEqualTo = point002[0])
assert(point001[1], isEqualTo = point002[1])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the parabolicPoint function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-parabolicPoint0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-parabolicPoint0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


