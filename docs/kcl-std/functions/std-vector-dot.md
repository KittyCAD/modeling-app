---
title: "vector::dot"
subtitle: "Function in std::vector"
excerpt: "Find the dot product of two points or vectors of any dimension."
layout: manual
---

Find the dot product of two points or vectors of any dimension.

```kcl
vector::dot(
  @u: [number],
  v: [number],
): number
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `u` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |
| `v` | [[`number`](/docs/kcl-std/types/std-types-number)] |  | Yes |

### Returns

[`number`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
u = [1, 2, 3]
v = [4, -5, 6]
dotprod = vector::dot(u, v)
assert(dotprod, isEqualTo = 12)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the vector::dot function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-vector-dot0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-vector-dot0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


