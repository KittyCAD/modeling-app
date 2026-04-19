---
title: "map"
subtitle: "Function in std::array"
excerpt: "Apply a function to every element of a list."
layout: manual
---

Apply a function to every element of a list.

```kcl
map(
  @array: [any],
  f: fn(any): any,
): [any]
```

Given a list like `[a, b, c]`, and a function like `f`, returns
`[f(a), f(b), f(c)]`

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | `[any]` | Input array. The output array is this input array, but every element has had the function `f` run on it. | Yes |
| `f` | `fn(any): any` | A function. The output array is just the input array, but `f` has been run on every item. | Yes |

### Returns

`[any]`



