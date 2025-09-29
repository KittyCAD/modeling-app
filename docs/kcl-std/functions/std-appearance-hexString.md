---
title: "appearance::hexString"
subtitle: "Function in std::appearance"
excerpt: "Build a color from its red, green and blue components. These must be between 0 and 255."
layout: manual
---

Build a color from its red, green and blue components. These must be between 0 and 255.

```kcl
appearance::hexString(@rgb: [number(_); 3]): string
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `rgb` | [`[number(_); 3]`](/docs/kcl-std/types/std-types-number) | The red, blue and green components of the color. Must be between 0 and 255. | Yes |

### Returns

[`string`](/docs/kcl-std/types/std-types-string) - A sequence of characters


### Examples

```kcl
startSketchOn(-XZ)
  |> circle(center = [0, 0], radius = 10)
  |> extrude(length = 4)
  |> appearance(color = appearance::hexString([50, 160, 160]))

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance::hexString function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-appearance-hexString0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-appearance-hexString0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sideLen = 30
n = 10

// The cubes become more green and less blue with each instance.
fn cube(i, center) {
  g = 255 / n * i
  b = 255 / n * (n - i)
  return startSketchOn(XY)
    |> polygon(radius = sideLen / 2, numSides = 4, center = [center, 0])
    |> extrude(length = sideLen)
    |> appearance(color = appearance::hexString([0, g, b]), metalness = 80, roughness = 20)
}

// Create n cubes, shifting each one over in a line.
map(
  [0..n],
  f = fn(@i) {
    return cube(i, center = sideLen * i * 1.5)
  },
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance::hexString function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-appearance-hexString1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-appearance-hexString1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sideLen = 30
n = 6

fn cube(offset, i, red) {
  x = floor(i / n)
  y = rem(i, divisor = n)
  g = 255 / n * x
  b = 255 / n * y
  return startSketchOn(offsetPlane(XZ, offset))
    |> circle(diameter = sideLen, center = [sideLen * x * 1.5, sideLen * y * 1.5])
    |> extrude(length = sideLen)
    |> appearance(color = appearance::hexString([red, g, b]), metalness = 80, roughness = 40)
}

fn grid(offset, red) {
  return map(
    [0 ..< n * n],
    f = fn(@i) {
      return cube(offset, i, red)
    },
  )
}

grid(offset = 0, red = 0)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance::hexString function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-appearance-hexString2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-appearance-hexString2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
sideLen = 30
n = 4

fn cube(offset, i, red) {
  x = floor(i / n)
  y = rem(i, divisor = n)
  g = 255 / n * x
  b = 255 / n * y
  return startSketchOn(offsetPlane(XY, offset))
    |> circle(diameter = sideLen, center = [sideLen * x * 1.5, sideLen * y * 1.5])
    |> extrude(length = sideLen)
    |> appearance(color = appearance::hexString([red, g, b]), metalness = 80, roughness = 40)
}

fn grid(offset, red) {
  return map(
    [0 ..< n * n],
    f = fn(@i) {
      return cube(offset, i, red)
    },
  )
}

map(
  [0..<n],
  f = fn(@i) {
    return grid(offset = i * sideLen * 2, red = 255 * i / n)
  },
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the appearance::hexString function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-appearance-hexString3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-appearance-hexString3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


