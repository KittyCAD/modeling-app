---
title: "map"
subtitle: "Function in std::array"
excerpt: "Apply a function to every element of a list."
layout: manual
---

Apply a function to every element of a list.

```kcl
map(
  @array: [any],
  f: fn(any): any,
): [any]
```

Given a list like `[a, b, c]`, and a function like `f`, returns
`[f(a), f(b), f(c)]`

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [`[any]`](/docs/kcl-std/types/std-types-any) | Input array. The output array is this input array, but every element has had the function `f` run on it. | Yes |
| `f` | [`fn(any): any`](/docs/kcl-std/types/std-types-fn) | A function. The output array is just the input array, but `f` has been run on every item. | Yes |

### Returns

[`[any]`](/docs/kcl-std/types/std-types-any)


### Examples

```kcl
r = 10 // radius
fn drawCircle(@id) {
  return startSketchOn(XY)
    |> circle(center = [id * 2 * r, 0], radius = r)
}

// Call `drawCircle`, passing in each element of the array.
// The outputs from each `drawCircle` form a new array,
// which is the return value from `map`.
circles = map([1..3], f = drawCircle)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-map0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-map0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
r = 10 // radius
// Call `map`, using an anonymous function instead of a named one.
circles = map(
  [1..3],
  f = fn(@id) {
    return startSketchOn(XY)
      |> circle(center = [id * 2 * r, 0], radius = r)
  },
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-map1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-map1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


