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
assert(
  new_arr[3],
  isEqualTo = 4,
  tolerance = 0.1,
  error = "4 was added to the end of the array",
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-push0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-push0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


