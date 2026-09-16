---
title: "segEnd"
subtitle: "Function in std::sketch"
excerpt: "Compute the ending point of the provided line segment."
layout: manual
---

Compute the ending point of the provided line segment.

```kcl
segEnd(@tag: TaggedEdge): Point2d
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `tag` | [`TaggedEdge`](/docs/kcl-std/types/std-types-TaggedEdge) | The line segment being queried by its tag. | Yes |

### Returns

[`Point2d`](/docs/kcl-std/types/std-types-Point2d) - A point in two dimensional space.


### Examples

```kcl
w = 15
cube = startSketchOn(XY)
  |> startProfile(at = [0, 0])
  |> line(end = [w, 0], tag = $line1)
  |> line(end = [0, w], tag = $line2)
  |> line(end = [-w, 0], tag = $line3)
  |> line(end = [0, -w], tag = $line4)
  |> close()
  |> extrude(length = 5)

fn cylinder(radius, tag) {
  return startSketchOn(XY)
    |> startProfile(at = [0, 0])
    |> circle(radius = radius, center = segEnd(tag))
    |> extrude(length = radius)
}

cylinder(radius = 1, tag = line1)
cylinder(radius = 2, tag = line2)
cylinder(radius = 3, tag = line3)
cylinder(radius = 4, tag = line4)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the segEnd function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-segEnd0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-segEnd0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


