---
title: "rem"
subtitle: "Function in std::math"
excerpt: "Compute the remainder after dividing `num` by `div`. If `num` is negative, the result will be too."
layout: manual
---

Compute the remainder after dividing `num` by `div`. If `num` is negative, the result will be too.

```kcl
rem(
  @num: number,
  divisor: number,
): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | [`number`](/docs/kcl-std/types/std-types-number) | The number which will be divided by `divisor`. | Yes |
| `divisor` | [`number`](/docs/kcl-std/types/std-types-number) | The number which will divide `num`. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
assert(rem(7, divisor = 4), isEqualTo = 3, error = "remainder is 3")
assert(rem(-7, divisor = 4), isEqualTo = -3, error = "remainder is -3")
assert(rem(7, divisor = -4), isEqualTo = 3, error = "remainder is 3")
assert(rem(6, divisor = 2.5), isEqualTo = 1, error = "remainder is 1")
assert(rem(6.5, divisor = 2.5), isEqualTo = 1.5, error = "remainder is 1.5")
assert(rem(6.5, divisor = 2), isEqualTo = 0.5, error = "remainder is 0.5")

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-math-rem0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-math-rem0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


