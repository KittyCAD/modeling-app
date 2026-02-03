---
title: "conic"
subtitle: "Function in std::sketch"
excerpt: "Add a conic section to an existing sketch."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Add a conic section to an existing sketch.

```kcl
conic(
  @sketch: Sketch,
  interiorAbsolute?: Point2d,
  endAbsolute?: Point2d,
  interior?: Point2d,
  end?: Point2d,
  coefficients?: [number; 6],
  startTangent?: Point2d,
  endTangent?: Point2d,
  tag?: TagDecl,
): Sketch
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | Which sketch should this path be added to? | Yes |
| `interiorAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Any point between the segment's start and end. Requires `endAbsolute`. Incompatible with `interior` or `end`. | No |
| `endAbsolute` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should this segment end? Requires `interiorAbsolute`. Incompatible with `interior` or `end`. | No |
| `interior` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Any point between the segment's start and end. This point is relative to the start point. Requires `end`. Incompatible with `interiorAbsolute` or `endAbsolute`. | No |
| `end` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | Where should this segment end? This point is relative to the start point. Requires `interior`. Incompatible with `interiorAbsolute` or `endAbsolute`. | No |
| `coefficients` | [[`number`](/docs/kcl-std/types/std-types-number); 6] | The coefficients [a, b, c, d, e, f] of the generic conic equation ax^2 + by^2 + cxy + dx + ey + f = 0. If provided the start and end tangents will be calculated using this equation. Incompatible with `startTangent` and `endTangent`. | No |
| `startTangent` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The tangent of the conic section at the start. If not provided the tangent of the previous path segment is used. Incompatible with `coefficients`. | No |
| `endTangent` | [`Point2d`](/docs/kcl-std/types/std-types-Point2d) | The tangent of the conic section at the end. Incompatible with `coefficients`. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this segment. | No |

### Returns

[`Sketch`](/docs/kcl-std/types/std-types-Sketch) - A sketch is a collection of paths.


### Examples

```kcl
@settings(experimentalFeatures = allow)

exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> conic(
       end = [20, 0],
       endTangent = [1, 1],
       interior = [5, 5],
       startTangent = [0, -1],
     )
  |> close()
example = extrude(exampleSketch, length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the conic function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-conic0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-conic0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


