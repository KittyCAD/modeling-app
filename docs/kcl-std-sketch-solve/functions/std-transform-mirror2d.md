---
title: "mirror2d"
subtitle: "Function in std::transform"
excerpt: "Mirror a sketch."
layout: manual
---

Mirror a sketch.

```kcl
mirror2d(
  @sketches: [Sketch; 1+],
  axis: Axis2d | Edge | Segment,
): Sketch
```

Mirror occurs around a local sketch axis rather than a global axis.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 1+] | The sketch or sketches to be reflected. | Yes |
| `axis` | [`Axis2d`](/docs/kcl-std/types/std-types-Axis2d) or [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | The axis to reflect around. | Yes |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
// Mirror an un-closed sketch across a line from a sketch block.
helper001 = sketch(on = XZ) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 0mm, var 10mm])
}

sketch001 = startSketchOn(XZ)
  |> startProfile(at = [0, 8.5])
  |> line(end = [20, -8.5])
  |> line(end = [-20, -8.5])
  |> mirror2d(axis = helper001.line1)

// example = extrude(sketch001, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the mirror2d function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-transform-mirror2d3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-transform-mirror2d3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


