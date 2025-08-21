---
title: "reduce"
subtitle: "Function in std::array"
excerpt: "Take a starting value. Then, for each element of an array, calculate the next value, using the previous value and the element."
layout: manual
---

Take a starting value. Then, for each element of an array, calculate the next value, using the previous value and the element.

```kcl
reduce(
  @array: [any],
  initial: any,
  f: fn(any, accum: any): any,
): any
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `array` | [`[any]`](/docs/kcl-std/types/std-types-any) | Each element of this array gets run through the function `f`, combined with the previous output from `f`, and then used for the next run. | Yes |
| `initial` | [`any`](/docs/kcl-std/types/std-types-any) | The first time `f` is run, it will be called with the first item of `array` and this initial starting value. | Yes |
| `f` | [`fn(any, accum: any): any`](/docs/kcl-std/types/std-types-fn) | Run once per item in the input `array`. This function takes an item from the array, and the previous output from `f` (or `initial` on the very first run). The final time `f` is run, its output is returned as the final output from `reduce`. | Yes |

### Returns

[`any`](/docs/kcl-std/types/std-types-any) - The [`any`](/docs/kcl-std/types/std-types-any) type is the type of all possible values in KCL. I.e., if a function accepts an argument with type [`any`](/docs/kcl-std/types/std-types-any), then it can accept any value.


### Examples

```kcl
// This function adds two numbers.
fn add(@a, accum) {
  return a + accum
}

// This function adds an array of numbers.
// It uses the `reduce` function, to call the `add` function on every
// element of the `arr` parameter. The starting value is 0.
fn sum(@arr) {
  return reduce(arr, initial = 0, f = add)
}

/* The above is basically like this pseudo-code:
fn sum(arr):
    sumSoFar = 0
    for i in arr:
        sumSoFar = add(i, sumSoFar)
    return sumSoFar */

// We use `assert` to check that our `sum` function gives the
// expected result. It's good to check your work!
assert(
  sum([1, 2, 3]),
  isEqualTo = 6,
  tolerance = 0.1,
  error = "1 + 2 + 3 summed is 6",
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-reduce0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-reduce0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// This example works just like the previous example above, but it uses
// an anonymous `add` function as its parameter, instead of declaring a
// named function outside.
arr = [1, 2, 3]
sum = reduce(
  arr,
  initial = 0,
  f = fn(@i, accum) {
    return i + accum
  },
)

// We use `assert` to check that our `sum` function gives the
// expected result. It's good to check your work!
assert(
  sum,
  isEqualTo = 6,
  tolerance = 0.1,
  error = "1 + 2 + 3 summed is 6",
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-reduce1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-reduce1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Declare a function that sketches a decagon.
fn decagon(@radius) {
  // Each side of the decagon is turned this many radians from the previous angle.
  stepAngle = (1 / 10 * TAU): rad

  // Start the decagon sketch at this point.
  startOfDecagonSketch = startSketchOn(XY)
    |> startProfile(at = [cos(0) * radius, sin(0) * radius])

    // Use a `reduce` to draw the remaining decagon sides.
    // For each number in the array 1..10, run the given function,
  // which takes a partially-sketched decagon and adds one more edge to it.
  fullDecagon = reduce(
    [1..10],
    initial = startOfDecagonSketch,
    f = fn(@i, accum) {
      // Draw one edge of the decagon.
      x = cos(stepAngle * i) * radius
      y = sin(stepAngle * i) * radius
      return line(accum, end = [x, y])
    },
  )

  return fullDecagon
}

/* The `decagon` above is basically like this pseudo-code:
fn decagon(radius):
    stepAngle = ((1/10) * TAU): rad
    plane = startSketchOn(XY)
    startOfDecagonSketch = startProfile(plane, at = [(cos(0)*radius), (sin(0) * radius)])

    // Here's the reduce part.
    partialDecagon = startOfDecagonSketch
    for i in [1..10]:
        x = cos(stepAngle * i) * radius
        y = sin(stepAngle * i) * radius
        partialDecagon = line(partialDecagon, end = [x, y])
    fullDecagon = partialDecagon // it's now full
    return fullDecagon */

// Use the `decagon` function declared above, to sketch a decagon with radius 5.
decagon(5.0)
  |> close()

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-array-reduce2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-array-reduce2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


