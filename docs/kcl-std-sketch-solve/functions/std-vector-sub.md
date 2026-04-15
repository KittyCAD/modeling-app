---
title: "vector::sub"
subtitle: "Function in std::vector"
excerpt: "Subtracts from every element of u its corresponding element in v. Both vectors must have the same length. Returns a new vector of the same length. In other words, component-wise subtraction."
layout: manual
---

Subtracts from every element of u its corresponding element in v. Both vectors must have the same length. Returns a new vector of the same length. In other words, component-wise subtraction.

```kcl
vector::sub(
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
v2 = vector::sub(u, v)
assert(v2[0], isEqualTo = 9)
assert(v2[1], isEqualTo = 8)
assert(v2[2], isEqualTo = 7)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the vector::sub function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-vector-sub0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-vector-sub0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


