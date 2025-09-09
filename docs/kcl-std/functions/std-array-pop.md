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
assert(
  new_arr[0],
  isEqualTo = 1,
  tolerance = 0.00001,
  error = "1 is the first element of the array",
)
assert(
  new_arr[1],
  isEqualTo = 2,
  tolerance = 0.00001,
  error = "2 is the second element of the array",
)
assert(
  new_arr[2],
  isEqualTo = 3,
  tolerance = 0.00001,
  error = "3 is the third element of the array",
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the pop function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-pop0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-pop0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


