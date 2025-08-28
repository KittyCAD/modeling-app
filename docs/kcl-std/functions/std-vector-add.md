---
title: "vector::add"
subtitle: "Function in std::vector"
excerpt: "Adds every element of u to its corresponding element in v. Both vectors must have the same length. Returns a new vector of the same length. In other words, component-wise addition."
layout: manual
---

Adds every element of u to its corresponding element in v. Both vectors must have the same length. Returns a new vector of the same length. In other words, component-wise addition.

```kcl
vector::add(
  @u: [number],
  v: [number],
): [number]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `u` | [`[number]`](/docs/kcl-std/types/std-types-number) |  | Yes |
| `v` | [`[number]`](/docs/kcl-std/types/std-types-number) |  | Yes |

### Returns

[`[number]`](/docs/kcl-std/types/std-types-number)


### Examples

```kcl
u = [1, 2, 3]
v = [10, 10, 10]
v2 = vector::add(u, v)
assert(v2[0], isEqualTo = 11)
assert(v2[1], isEqualTo = 12)
assert(v2[2], isEqualTo = 13)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-vector-add0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-vector-add0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


