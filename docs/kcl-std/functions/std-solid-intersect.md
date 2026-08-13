---
title: "intersect"
subtitle: "Function in std::solid"
excerpt: "Intersect returns the shared volume between multiple solids, preserving only overlapping regions."
layout: manual
---

Intersect returns the shared volume between multiple solids, preserving only overlapping regions.

```kcl
intersect(
  @solids: [Solid; 2+],
  tolerance?: number(Length),
): [Solid; 1+]
```

Intersect computes the geometric intersection of multiple solid bodies,
returning a new solid representing the volume that is common to all input
solids. This operation is useful for determining shared material regions,
verifying fit, and analyzing overlapping geometries in assemblies.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 2+] | The solids to intersect. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]


### Examples

```kcl
// Intersect two cubes using the stdlib functions.

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

intersectedPart = intersect([part001, part002])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the intersect function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-intersect0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-intersect0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Intersect two cubes using operators.
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

// This is the equivalent of: intersect([part001, part002])
intersectedPart = part001 & part002

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the intersect function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-intersect1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-intersect1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


