---
title: "subtract"
subtitle: "Function in std::solid"
excerpt: "Subtract removes tool solids from base solids, leaving the remaining material."
layout: manual
---

Subtract removes tool solids from base solids, leaving the remaining material.

```kcl
subtract(
  @solids: [Solid; 1+],
  tools: [Solid],
  tolerance?: number(Length),
): [Solid; 1+]
```

Performs a bool subtraction operation, removing the volume of one or more
tool solids from one or more base solids. The result is a new solid
representing the material that remains after all tool solids have been cut
away. This function is essential for machining simulations, cavity creation,
and complex multi-body part modeling.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid) | The solids to use as the base to subtract from. | Yes |
| `tools` | [`[Solid]`](/docs/kcl-std/types/std-types-Solid) | The solids to subtract. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

[`[Solid; 1+]`](/docs/kcl-std/types/std-types-Solid)


### Examples

```kcl
// Subtract a cylinder from a cube using the stdlib functions.


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

subtractedPart = subtract([part001], tools = [part002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-subtract0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-subtract0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Subtract a cylinder from a cube using operators.
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

// This is the equivalent of: subtract([part001], tools=[part002])
subtractedPart = part001 - part002

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the  function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-subtract1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-subtract1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


