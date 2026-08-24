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
  legacyMethod?: bool,
): [Solid]
```

Performs a bool subtraction operation, removing the volume of one or more
tool solids from one or more base solids. The result is a new solid
representing the material that remains after all tool solids have been cut
away. This function is essential for machining simulations, cavity creation,
and complex multi-body part modeling.

This operation consumes both the base solids and the tool solids. After it
succeeds, neither set of original variables can be used in another modeling
operation. Assign the returned solid or solids to a new variable and use that
result for subsequent operations. For multiple cuts, pass each `subtract`
result into the next call instead of reusing the original base solid.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The solids to use as the base to subtract from. These solids are consumed by this operation. | Yes |
| `tools` | [[`Solid`](/docs/kcl-std/types/std-types-Solid)] | The solids to subtract. These tool solids are also consumed by this operation. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `legacyMethod` | [`bool`](/docs/kcl-std/types/std-types-bool) | **Deprecated as of KCL 2.0.** You probably shouldn't set this or care about this, it's for opting back into an older version of an engine algorithm. If true, revert to older engine SSI algorithm. Defaults to false. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid)]


### Examples

```kcl
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

baseSketch = sketch(on = XY) {
  bottom = line(start = [var -10mm, var -10mm], end = [var 10mm, var -10mm])
  right = line(start = [var 10mm, var -10mm], end = [var 10mm, var 10mm])
  top = line(start = [var 10mm, var 10mm], end = [var -10mm, var 10mm])
  left = line(start = [var -10mm, var 10mm], end = [var -10mm, var -10mm])
  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
}
baseRegion = region(segments = [baseSketch.bottom, baseSketch.right])
base = extrude(baseRegion, length = 10mm)

toolSketch = sketch(on = XY) {
  bottom = line(start = [var 2mm, var -2mm], end = [var 12mm, var -2mm])
  right = line(start = [var 12mm, var -2mm], end = [var 12mm, var 8mm])
  top = line(start = [var 12mm, var 8mm], end = [var 2mm, var 8mm])
  left = line(start = [var 2mm, var 8mm], end = [var 2mm, var -2mm])
  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
}
toolRegion = region(segments = [toolSketch.bottom, toolSketch.right])
tool = extrude(toolRegion, length = 10mm)
  |> translate(z = 1mm)

subtractedPart = subtract([base], tools = [tool])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the subtract function"
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
@settings(defaultLengthUnit = mm, kclVersion = 2.0)

baseSketch = sketch(on = XY) {
  bottom = line(start = [var -10mm, var -10mm], end = [var 10mm, var -10mm])
  right = line(start = [var 10mm, var -10mm], end = [var 10mm, var 10mm])
  top = line(start = [var 10mm, var 10mm], end = [var -10mm, var 10mm])
  left = line(start = [var -10mm, var 10mm], end = [var -10mm, var -10mm])
  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
}
baseRegion = region(segments = [baseSketch.bottom, baseSketch.right])
base = extrude(baseRegion, length = 10mm)

toolSketch = sketch(on = XY) {
  bottom = line(start = [var 2mm, var -2mm], end = [var 12mm, var -2mm])
  right = line(start = [var 12mm, var -2mm], end = [var 12mm, var 8mm])
  top = line(start = [var 12mm, var 8mm], end = [var 2mm, var 8mm])
  left = line(start = [var 2mm, var 8mm], end = [var 2mm, var -2mm])
  coincident([bottom.end, right.start])
  coincident([right.end, top.start])
  coincident([top.end, left.start])
  coincident([left.end, bottom.start])
}
toolRegion = region(segments = [toolSketch.bottom, toolSketch.right])
tool = extrude(toolRegion, length = 10mm)
  |> translate(z = 1mm)

// This is equivalent to: subtract([base], tools = [tool])
subtractedPart = base - tool

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the subtract function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-subtract1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-subtract1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


