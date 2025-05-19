---
title: "pop"
subtitle: "Function in std::array"
excerpt: "Remove the last element from an array."
layout: manual
---

Remove the last element from an array.

```kcl
pop(@array: [any; 1+]): [any]
```

Returns a new array with the last element removed.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [`[any; 1+]`](/docs/kcl-std/types/std-types-any) | The array to pop from. Must not be empty. | Yes |

### Returns

[`[any]`](/docs/kcl-std/types/std-types-any)


### Examples

```kcl
arr = [1, 2, 3, 4]
new_arr = pop(arr)
assert(new_arr[0], isEqualTo = 1, tolerance = 0.00001, error = "1 is the first element of the array")
assert(new_arr[1], isEqualTo = 2, tolerance = 0.00001, error = "2 is the second element of the array")
assert(new_arr[2], isEqualTo = 3, tolerance = 0.00001, error = "3 is the third element of the array")
```



