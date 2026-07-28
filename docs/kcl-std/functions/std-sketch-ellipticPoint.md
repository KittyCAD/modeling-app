---
title: "ellipticPoint"
subtitle: "Function in std::sketch"
excerpt: "Calculate the point (x, y) on an ellipse given x or y and the center and major/minor radii of the ellipse."
layout: manual
---

Calculate the point (x, y) on an ellipse given x or y and the center and major/minor radii of the ellipse.

```kcl
ellipticPoint(
  majorRadius: number,
  minorRadius: number,
  x?: number(Length),
  y?: number(Length),
): Point2d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `majorRadius` | [`number`](/docs/kcl-std/types/std-types-number) | The major radius, a, of the elliptic equation x^2 / a ^ 2 + y^2 / b^2 = 1. | Yes |
| `minorRadius` | [`number`](/docs/kcl-std/types/std-types-number) | The minor radius, b, of the hyperbolic equation x^2 / a ^ 2 + y^2 / b^2 = 1. | Yes |
| `x` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The x value. Calculates y and returns (x, y). Incompatible with `y`. | No |
| `y` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | The y value. Calculates x and returns (x, y). Incompatible with `x`. | No |

### Returns

[`Point2d`](/docs/kcl-std/types/std-types-Point2d) - A point in two dimensional space.


### Examples

```kcl
point001 = ellipticPoint(x = 2, majorRadius = 2, minorRadius = 1)
point002 = ellipticPoint(y = 0, majorRadius = 2, minorRadius = 1)
assert(point001[0], isEqualTo = point002[0])
assert(point001[1], isEqualTo = point002[1])

```


![Rendered example of ellipticPoint 0](/kcl-test-outputs/serial_test_example_fn_std-sketch-ellipticPoint0.png)


