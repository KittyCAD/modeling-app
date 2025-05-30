---
title: "assert"
subtitle: "Function in std"
excerpt: ""
layout: manual
---



```kcl
assert(
  @actual: number,
  isGreaterThan?: number,
  isLessThan?: number,
  isGreaterThanOrEqual?: number,
  isLessThanOrEqual?: number,
  isEqualTo?: number,
  tolerance?: number,
  error?: string,
)
```

Check a value meets some expected conditions at runtime. Program terminates with an error if conditions aren't met.
If you provide multiple conditions, they will all be checked and all must be met.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `actual` | [`number`](/docs/kcl-std/types/std-types-number) | Value to check. If this is the boolean value true, assert passes. Otherwise it fails.. | Yes |
| `isGreaterThan` | [`number`](/docs/kcl-std/types/std-types-number) | Comparison argument. If given, checks the `actual` value is greater than this. | No |
| `isLessThan` | [`number`](/docs/kcl-std/types/std-types-number) | Comparison argument. If given, checks the `actual` value is less than this. | No |
| `isGreaterThanOrEqual` | [`number`](/docs/kcl-std/types/std-types-number) | Comparison argument. If given, checks the `actual` value is greater than or equal to this. | No |
| `isLessThanOrEqual` | [`number`](/docs/kcl-std/types/std-types-number) | Comparison argument. If given, checks the `actual` value is less than or equal to this. | No |
| `isEqualTo` | [`number`](/docs/kcl-std/types/std-types-number) | Comparison argument. If given, checks the `actual` value is less than or equal to this. | No |
| `tolerance` | [`number`](/docs/kcl-std/types/std-types-number) | If `isEqualTo` is used, this is the tolerance to allow for the comparison. This tolerance is used because KCL's number system has some floating-point imprecision when used with very large decimal places. | No |
| `error` | [`string`](/docs/kcl-std/types/std-types-string) | If the value was false, the program will terminate with this error message | No |


### Examples

```kcl
n = 10
assert(n, isEqualTo = 10)
assert(n, isGreaterThanOrEqual = 0, isLessThan = 100, error = "number should be between 0 and 100")
assert(1.0000000000012, isEqualTo = 1, tolerance = 0.0001, error = "number should be almost exactly 1")
```



