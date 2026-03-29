---
title: "getBoundedEdge"
subtitle: "Function in std::sketch"
excerpt: "Get a bounded edge of a surface used for the [blend](/docs/kcl-std/functions/std-solid-blend) operation. A bounded edge is a reference to an existing edge that can be clipped at both ends. This will result in only the non-clipped portion of the edge being used during the blend."
layout: manual
---

Get a bounded edge of a surface used for the [blend](/docs/kcl-std/functions/std-solid-blend) operation. A bounded edge is a reference to an existing edge that can be clipped at both ends. This will result in only the non-clipped portion of the edge being used during the blend.

```kcl
getBoundedEdge(
  @solid: Solid,
  edge: Edge,
  lowerBound?: number(_),
  upperBound?: number(_),
): BoundedEdge
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid that the edge belongs to. | Yes |
| `edge` | [`Edge`](/docs/kcl-std/types/std-types-Edge) | The edge to bound. This can be a tagged edge or an edge ID from `edgeId(...)`. | Yes |
| `lowerBound` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A lower percentage bound of the edge, must be between 0 and 1 inclusive. Defaults to 0. | No |
| `upperBound` | [`number(_)`](/docs/kcl-std/types/std-types-number) | A upper percentage bound of the edge, must be between 0 and 1 inclusive. Defaults to 1. | No |

### Returns

[`BoundedEdge`](/docs/kcl-std/types/std-types-BoundedEdge) - A [bounded edge](/docs/kcl-std/functions/std-sketch-getBoundedEdge) of a solid.


### Examples

```kcl
@settings(experimentalFeatures = allow)

sketch001 = sketch(on = YZ) {
  line1 = line(start = [var 4.1mm, var -0.1mm], end = [var 5.5mm, var 0mm])
  line2 = line(start = [var 5.5mm, var 0mm], end = [var 5.5mm, var 3mm])
  line3 = line(start = [var 5.5mm, var 3mm], end = [var 3.9mm, var 2.8mm])
  line4 = line(start = [var 4.1mm, var 3mm], end = [var 4.5mm, var -0.2mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
}

sketch002 = sketch(on = -XZ) {
  line5 = line(start = [var -5.3mm, var -0.1mm], end = [var -3.5mm, var -0.1mm])
  line6 = line(start = [var -3.5mm, var -0.1mm], end = [var -3.5mm, var 3.1mm])
  line7 = line(start = [var -3.5mm, var 4.5mm], end = [var -5.4mm, var 4.5mm])
  line8 = line(start = [var -5.3mm, var 3.1mm], end = [var -5.3mm, var -0.1mm])
  coincident([line5.end, line6.start])
  coincident([line6.end, line7.start])
  coincident([line7.end, line8.start])
  coincident([line8.end, line5.start])
}

region001 = region(point = [-4.4mm, 2mm], sketch = sketch002)
extrude001 = extrude(region001, length = -2mm, bodyType = SURFACE)
region002 = region(point = [4.8mm, 1.5mm], sketch = sketch001)
extrude002 = extrude(region002, length = -2mm, bodyType = SURFACE)

boundedEdge1 = getBoundedEdge(
  extrude001,
  edge = extrude001.sketch.tags.line7,
  lowerBound = 0.1,
  upperBound = 0.9,
)
boundedEdge2 = getBoundedEdge(
  extrude002,
  edge = extrude002.sketch.tags.line3,
  lowerBound = 0.4,
  upperBound = 0.6,
)

blend([boundedEdge1, boundedEdge2])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the getBoundedEdge function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-getBoundedEdge0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-getBoundedEdge0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


