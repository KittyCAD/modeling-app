---
title: "push"
subtitle: "Function in std::array"
excerpt: "Append an element to the end of an array."
layout: manual
---

Append an element to the end of an array.

```kcl
push(
  @array: [any],
  item: any,
): [any; 1+]
```

Returns a new array with the element appended.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [`[any]`](/docs/kcl-std/types/std-types-any) | The array which you're adding a new item to. | Yes |
| `item` | [`any`](/docs/kcl-std/types/std-types-any) | The new item to add to the array | Yes |

### Returns

[`[any; 1+]`](/docs/kcl-std/types/std-types-any)


### Examples

```kcl
arr = [1, 2, 3]
new_arr = push(arr, item = 4)
assert(new_arr[3], isEqualTo = 4, tolerance = 0.1, error = "4 was added to the end of the array")
```



