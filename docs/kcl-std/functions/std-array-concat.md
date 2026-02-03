---
title: "concat"
subtitle: "Function in std::array"
excerpt: "Combine two arrays into one by concatenating them."
layout: manual
---

Combine two arrays into one by concatenating them.

```kcl
concat(
  @array: [any],
  items: [any],
): [any]
```

Returns a new array with the all the elements of the first array followed by all the elements of the second array.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [[`any`](/docs/kcl-std/types/std-types-any)] | The array of starting elements. | Yes |
| `items` | [[`any`](/docs/kcl-std/types/std-types-any)] | The array of ending elements. | Yes |

### Returns

[[`any`](/docs/kcl-std/types/std-types-any)]


### Examples

```kcl
arr1 = [10, 20, 30]
arr2 = [40, 50, 60]
newArr = concat(arr1, items = arr2)
assert(newArr[0], isEqualTo = 10, tolerance = 0.00001)
assert(newArr[1], isEqualTo = 20, tolerance = 0.00001)
assert(newArr[2], isEqualTo = 30, tolerance = 0.00001)
assert(newArr[3], isEqualTo = 40, tolerance = 0.00001)
assert(newArr[4], isEqualTo = 50, tolerance = 0.00001)
assert(newArr[5], isEqualTo = 60, tolerance = 0.00001)
assert(count(newArr), isEqualTo = 6, tolerance = 0.00001)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the concat function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-concat0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-concat0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Concatenating an empty array has no effect.
newArr = concat([10, 20, 30], items = [])
assert(newArr[0], isEqualTo = 10, tolerance = 0.00001)
assert(newArr[1], isEqualTo = 20, tolerance = 0.00001)
assert(newArr[2], isEqualTo = 30, tolerance = 0.00001)
assert(count(newArr), isEqualTo = 3, tolerance = 0.00001)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the concat function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-concat1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-concat1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


