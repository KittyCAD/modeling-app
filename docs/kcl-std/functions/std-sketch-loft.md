---
title: "loft"
subtitle: "Function in std::sketch"
excerpt: "Create a 3D surface or solid by interpolating between two or more sketches."
layout: manual
---

Create a 3D surface or solid by interpolating between two or more sketches.

```kcl
loft(
  @sketches: [Sketch; 2+],
  vDegree?: number(_),
  bezApproximateRational?: bool,
  baseCurveIndex?: number(_),
  tolerance?: number(Length),
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  bodyType?: string,
): Solid
```

The sketches need to be closed and on different planes that are parallel.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch); 2+] | Which sketches to loft. Must include at least 2 sketches. | Yes |
| `vDegree` | [`number(_)`](/docs/kcl-std/types/std-types-number) | Degree of the interpolation. Must be greater than zero. For example, use 2 for quadratic, or 3 for cubic interpolation in the V direction. | No |
| `bezApproximateRational` | [`bool`](/docs/kcl-std/types/std-types-bool) | Attempt to approximate rational curves (such as arcs) using a bezier. This will remove banding around interpolations between arcs and non-arcs. It may produce errors in other scenarios. Over time, this field won't be necessary. | No |
| `baseCurveIndex` | [`number(_)`](/docs/kcl-std/types/std-types-number) | This can be set to override the automatically determined topological base curve, which is usually the first section encountered. | No |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `tagStart` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the start of the loft, i.e. the original sketch. | No |
| `tagEnd` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | A named tag for the face at the end of the loft. | No |
| `bodyType` | [`string`](/docs/kcl-std/types/std-types-string) | What type of body to produce (solid or surface). Defaults to "solid". | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Loft a square and a triangle.
squareSketch = startSketchOn(XY)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

triangleSketch = startSketchOn(offsetPlane(XY, offset = 75))
  |> startProfile(at = [0, 125])
  |> line(end = [-15, -30])
  |> line(end = [30, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

loft([triangleSketch, squareSketch])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft0_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Loft a square, a circle, and another circle.
squareSketch = startSketchOn(XY)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch0 = startSketchOn(offsetPlane(XY, offset = 75))
  |> circle(center = [0, 100], radius = 50)

circleSketch1 = startSketchOn(offsetPlane(XY, offset = 150))
  |> circle(center = [0, 100], radius = 20)

loft([
       squareSketch,
       circleSketch0,
       circleSketch1
     ])
  |> appearance(color = "#da7333", roughness = 50, metalness = 90)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft1_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Loft a square, a circle, and another circle with options.
squareSketch = startSketchOn(XY)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()

circleSketch0 = startSketchOn(offsetPlane(XY, offset = 75))
  |> circle(center = [0, 100], radius = 50)

circleSketch1 = startSketchOn(offsetPlane(XY, offset = 150))
  |> circle(center = [0, 100], radius = 20)

loft(
  [
    squareSketch,
    circleSketch0,
    circleSketch1
  ],
  baseCurveIndex = 0,
  bezApproximateRational = false,
  tolerance = 0.000001,
  vDegree = 2,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft2_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch a square on the XY plane
squareSketch = startSketchOn(XY)
  |> startProfile(at = [-100, 200])
  |> line(end = [200, 0])
  |> line(end = [0, -200])
  |> line(end = [-200, 0])
  |> close()

// Start a second sketch, 200 units above the XY plane.
circleSketch = startSketchOn(offsetPlane(XY, offset = 100))
  |> circle(center = [0, 100], radius = 50)

squareSketch002 = clone(squareSketch)
  |> translate(z = 200)

// Loft the square up and into the circle.
loft(
  [
    squareSketch,
    circleSketch,
    squareSketch002
  ],
  bodyType = SURFACE,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft3_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


