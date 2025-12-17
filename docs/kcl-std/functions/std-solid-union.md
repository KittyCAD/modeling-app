---
title: "union"
subtitle: "Function in std::solid"
excerpt: "Union two or more solids into a single solid."
layout: manual
---

Union two or more solids into a single solid.

```kcl
union(
  @solids: [Solid; 2+],
  tolerance?: number(Length),
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 2+] | The solids to union. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
// Union two cubes using the stdlib functions.


fn cube(center, size) {
  return startSketchOn(XY)
    |> startProfile(at = [center[0] - size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] + size])
    |> line(endAbsolute = [center[0] - size, center[1] + size])
    |> close()
    |> extrude(length = 10)
}

part001 = cube(center = [0, 0], size = 10)
part002 = cube(center = [7, 3], size = 5)
  |> translate(z = 1)

unionedPart = union([part001, part002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the union function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-union0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-union0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Union two cubes using operators.
// NOTE: This will not work when using codemods through the UI.
// Codemods will generate the stdlib function call instead.


fn cube(center, size) {
  return startSketchOn(XY)
    |> startProfile(at = [center[0] - size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] + size])
    |> line(endAbsolute = [center[0] - size, center[1] + size])
    |> close()
    |> extrude(length = 10)
}

part001 = cube(center = [0, 0], size = 10)
part002 = cube(center = [7, 3], size = 5)
  |> translate(z = 1)

// This is the equivalent of: union([part001, part002])
unionedPart = part001 + part002

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the union function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-union1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-union1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Union two cubes using the more programmer-friendly operator.
// NOTE: This will not work when using codemods through the UI.
// Codemods will generate the stdlib function call instead.


fn cube(center, size) {
  return startSketchOn(XY)
    |> startProfile(at = [center[0] - size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] - size])
    |> line(endAbsolute = [center[0] + size, center[1] + size])
    |> line(endAbsolute = [center[0] - size, center[1] + size])
    |> close()
    |> extrude(length = 10)
}

part001 = cube(center = [0, 0], size = 10)
part002 = cube(center = [7, 3], size = 5)
  |> translate(z = 1)

  // This is the equivalent of: union([part001, part002])
  // Programmers will understand `|` as a union operation, but mechanical engineers
// will understand `+`, we made both work.
unionedPart = part001 | part002

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the union function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-union2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-union2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


