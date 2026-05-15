---
title: "flatten"
subtitle: "Function in std::array"
excerpt: "Flatten an array by one level."
layout: manual
---

Flatten an array by one level.

```kcl
flatten(@array: [any]): [any]
```

Returns a new array where any nested arrays are expanded into the top-level
array. This only flattens one level deep.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [[`any`](/docs/kcl-std/types/std-types-any)] | The array to flatten by one level. | Yes |

### Returns

[[`any`](/docs/kcl-std/types/std-types-any)]


### Examples

```kcl
arr = [1, [2, 3], 4]
flat = flatten(arr)
assert(flat[0], isEqualTo = 1)
assert(flat[1], isEqualTo = 2)
assert(flat[2], isEqualTo = 3)
assert(flat[3], isEqualTo = 4)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the flatten function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-flatten0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-flatten0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
arr = [[1, 2], [3, [4]]]
flat = flatten(arr)
// Only one level of flattening occurs.
assert(flat[0], isEqualTo = 1)
assert(flat[1], isEqualTo = 2)
assert(flat[2], isEqualTo = 3)
assert(flat[3][0], isEqualTo = 4)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the flatten function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-flatten1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-flatten1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


