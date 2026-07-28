---
title: "slice"
subtitle: "Function in std::array"
excerpt: "Get a subarray from `start` (inclusive) to `end` (exclusive)."
layout: manual
---

Get a subarray from `start` (inclusive) to `end` (exclusive).

```kcl
slice(
  @array: [any],
  start?: number(_),
  end?: number(_),
): [any]
```

Returns a new array containing the elements in the requested range.
Negative indexes count from the end of the array, so `-1` is the last
element, `-2` is the second-to-last element, and so on.

If `start` is omitted, it defaults to `0`. If `end` is omitted, it
defaults to the length of the array.

It is an error to omit both `start` and `end`. Arrays are immutable, so
there's no need to copy the whole array.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [[`any`](/docs/kcl-std/types/std-types-any)] | The array to slice. | Yes |
| `start` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The starting index (inclusive). Defaults to `0`. | No |
| `end` | [`number(_)`](/docs/kcl-std/types/std-types-number) | The ending index (exclusive). Defaults to the array length. | No |

### Returns

[[`any`](/docs/kcl-std/types/std-types-any)]


### Examples

```kcl
s = slice([1, 2, 3, 4, 5], start = 1, end = 3)
assert(s[0], isEqualTo = 2)
assert(s[1], isEqualTo = 3)
assert(count(s), isEqualTo = 2)

```



```kcl
s = slice([1, 2, 3, 4, 5], end = -2)
assert(s[0], isEqualTo = 1)
assert(s[1], isEqualTo = 2)
assert(s[2], isEqualTo = 3)
assert(count(s), isEqualTo = 3)

```



```kcl
s = slice([1, 2, 3, 4, 5], start = -2)
assert(s[0], isEqualTo = 4)
assert(s[1], isEqualTo = 5)
assert(count(s), isEqualTo = 2)

```




