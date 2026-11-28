---
title: "segLen"
subtitle: "Function in std::sketch"
excerpt: "Compute the length of the provided segment."
layout: manual
---

Compute the length of the provided segment.

```kcl
segLen(@tag: TaggedEdge): number(Length)
```

For a straight line, this is the distance between its two ends. For a
circular arc, it is the length along the curve, not the straight-line
distance between its ends. For a circle, it is the circumference.
Ellipses, conics and Bezier curves are not supported.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The segment being queried by its tag. | Yes |

### Returns

[`number(Length)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> angledLine(angle = 60deg, length = 10, tag = $thing)
  |> tangentialArc(angle = -120deg, radius = 5)
  |> angledLine(angle = -60deg, length = segLen(thing))
  |> close()

example = extrude(exampleSketch, length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the segLen function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-segLen0_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-segLen0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


