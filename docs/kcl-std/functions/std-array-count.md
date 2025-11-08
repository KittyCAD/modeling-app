---
title: "count"
subtitle: "Function in std::array"
excerpt: "Find the number of elements in an array."
layout: manual
---

Find the number of elements in an array.

```kcl
count(@array: [any]): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [[`any`](/docs/kcl-std/types/std-types-any)] | The array whose length will be returned. | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
arr1 = [10, 20, 30]
assert(count(arr1), isEqualTo = 3)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the count function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-count0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-count0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


