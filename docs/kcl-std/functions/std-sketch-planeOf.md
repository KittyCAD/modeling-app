---
title: "planeOf"
subtitle: "Function in std::sketch"
excerpt: "Find the plane a face lies on. Returns an error if the face doesn't lie on any plane (for example, the curved face of a cylinder)"
layout: manual
---

Find the plane a face lies on. Returns an error if the face doesn't lie on any plane (for example, the curved face of a cylinder)

```kcl
planeOf(
  @solid: Solid,
  face: TaggedFace | Segment,
): Plane
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose face is being queried. | Yes |
| `face` | [`TaggedFace`](/docs/kcl-std/types/std-types-TaggedFace) or [`Segment`](/docs/kcl-std/types/std-types-Segment) | Find the plane which this face lies on. | Yes |

### Returns

[`Plane`](/docs/kcl-std/types/std-types-Plane) - An abstract plane.


### Examples

```kcl
triangle = startSketchOn(XY)
  |> polygon(radius = 3, numSides = 3, center = [0, 0])
  |> extrude(length = 2)

// Find the plane of the triangle's top face.
topPlane = planeOf(triangle, face = END)

// Create a new plane, above the triangle's top face.
startSketchOn(offsetPlane(topPlane, offset = 2))
  |> circle(radius = 1, center = [0, 0])
  |> extrude(length = 1)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the planeOf function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-planeOf0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-planeOf0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


