---
title: "sectionCut"
subtitle: "Function in std::solid"
excerpt: "Cut all active native solid bodies on one side of a plane."
layout: manual
---

Cut all active native solid bodies on one side of a plane.

```kcl
sectionCut(
  plane: Plane,
  reverse?: bool,
  padding?: number(Length),
): [Solid]
```

Add this call after modeling is complete. Bodies are discovered automatically,
including bodies created inside functions, arrays, objects and KCL modules.
The cutter is a circle sized from the model bounds and extruded beyond the
model. Each body's appearance is reapplied to all of its surviving pieces.
This modifies geometry, including exported geometry; remove the call to restore
the complete model. Consumed and deleted bodies are excluded. Sketches, surface
bodies and foreign imported geometry are not sectioned.

The positive-normal side is removed by default. Bodies entirely on that side
disappear; bodies entirely on the other side remain unchanged. The operation
consumes cut bodies; use the returned bodies for any subsequent modeling.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `plane` | [`Plane`](/docs/kcl-std/types/std-types-Plane) | Cutting plane. The normal follows the right-hand rule of its X and Y axes. | Yes |
| `reverse` | [`bool`](/docs/kcl-std/types/std-types-bool) | Remove the negative-normal side instead. | No |
| `padding` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Positive clearance added to the cutter radius and reach. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid)]


### Examples

```kcl
@settings(kclVersion = 2.0)

profile = sketch(on = XY) {
  outline = circle(center = [0mm, 0mm], start = [10mm, 0mm])
}
body = extrude(region(segments = [profile.outline]), length = 20mm)
appearance(
  body,
  color = "#cc7733",
  metalness = 80,
  roughness = 30,
)
sectioned = sectionCut(plane = offsetPlane(XY, offset = 10mm))

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the sectionCut function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-sectionCut0_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-sectionCut0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


