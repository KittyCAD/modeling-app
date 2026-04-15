---
title: "vector::mul"
subtitle: "Function in std::vector"
excerpt: "Multiplies every element of u by its corresponding element in v. Both vectors must have the same length. Returns a new vector of the same length. In other words, component-wise multiplication."
layout: manual
---

Multiplies every element of u by its corresponding element in v. Both vectors must have the same length. Returns a new vector of the same length. In other words, component-wise multiplication.

```kcl
vector::mul(
  @u: [number],
  v: [number],
): [number]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `u` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |
| `v` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |

### Returns

[[`number`](/docs/kcl-std/types/std-types-number)]


### Examples

```kcl
u = [10, 10, 10]
v = [1, 2, 3]
v2 = vector::mul(u, v)
assert(v2[0], isEqualTo = 10)
assert(v2[1], isEqualTo = 20)
assert(v2[2], isEqualTo = 30)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the vector::mul function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-vector-mul0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-vector-mul0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


