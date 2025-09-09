---
title: "vector::magnitude"
subtitle: "Function in std::vector"
excerpt: "Find the Euclidean distance of a vector."
layout: manual
---

Find the Euclidean distance of a vector.

```kcl
vector::magnitude(@v: [number]): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `v` | [`[number]`](/docs/kcl-std/types/std-types-number) |  | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
v = [3, 4]
m = vector::magnitude(v)
assert(m, isEqualTo = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the vector::magnitude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-vector-magnitude0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-vector-magnitude0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


