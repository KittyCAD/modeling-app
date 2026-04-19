---
title: "loft"
subtitle: "Function in std::sketch"
excerpt: "Create a 3D surface or solid by interpolating between two or more sketches."
layout: manual
---

Create a 3D surface or solid by interpolating between two or more sketches.

```kcl
loft(
  @sketches: [Sketch | [Segment; 1+]; 2+],
  vDegree?: number(_),
  bezApproximateRational?: bool,
  baseCurveIndex?: number(_),
  tolerance?: number(Length),
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  bodyType?: string,
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | [[`Sketch`](/docs/kcl-std/types/std-types-Sketch) or [[`Segment`](/docs/kcl-std/types/std-types-Segment); 1+]; 2+] | Which sketches to loft (or segments, for surface lofts). Must include at least 2 sketches. | Yes |
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
sketch001 = startSketchOn(XZ)
profile001 = startProfile(sketch001, at = [-3, 0])
  |> xLine(length = 6)
plane001 = offsetPlane(XZ, offset = -5)
sketch002 = startSketchOn(plane001)
profile002 = startProfile(sketch002, at = [-2, -2])
  |> line(endAbsolute = [-1.25, -0.5])
  |> tangentialArc(endAbsolute = [-0.5, 0])
  |> xLine(length = 1)
  |> tangentialArc(end = [0.75, -0.5])
  |> line(end = [0.75, -1.5])

plane002 = offsetPlane(XZ, offset = -10)
sketch003 = startSketchOn(plane002)
profile003 = startProfile(sketch003, at = [-2, -6])
  |> line(end = [0.75, 1.5])
  |> tangentialArc(end = [0.75, 0.5])
  |> line(end = [1, 0])
  |> tangentialArc(end = [0.75, -0.5])
  |> line(end = [0.75, -1.5])
plane003 = offsetPlane(XZ, offset = -15)
sketch004 = startSketchOn(plane003)
profile004 = startProfile(sketch004, at = [-3, -4])
  |> xLine(length = 6)

loft(
  [
    profile001,
    profile002,
    profile003,
    profile004
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

```kcl
sketch001 = startSketchOn(-XY)
profile001 = startProfile(sketch001, at = [-2, 3])
  |> arc(interiorAbsolute = [0, 5], endAbsolute = [2, 3])

sketch002 = startSketchOn(XZ)
profile002 = startProfile(sketch002, at = [2, 0])
  |> arc(interiorAbsolute = [0, -2], endAbsolute = [-2, 0])

sketch003 = startSketchOn(XY)
profile003 = startProfile(sketch003, at = [2, -3])
  |> arc(interiorAbsolute = [0, -5], endAbsolute = [-2, -3])

loft([profile001, profile002, profile003], bodyType = SURFACE)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft4_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
lowerProfile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 6mm, var 0mm])
  edge2 = line(start = [var 6mm, var 0mm], end = [var 6mm, var 4mm])
  edge3 = line(start = [var 6mm, var 4mm], end = [var 0mm, var 4mm])
  edge4 = line(start = [var 0mm, var 4mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
}

upperProfile = sketch(on = offsetPlane(XY, offset = 8mm)) {
  edge5 = line(start = [var 1.6mm, var 1mm], end = [var 4.4mm, var 1mm])
  edge6 = line(start = [var 4.4mm, var 1mm], end = [var 3.2mm, var 2.6mm])
  edge7 = line(start = [var 3.2mm, var 2.6mm], end = [var 2.8mm, var 2.6mm])
  edge8 = line(start = [var 2.8mm, var 2.6mm], end = [var 1.6mm, var 1mm])
  coincident([edge5.end, edge6.start])
  coincident([edge6.end, edge7.start])
  coincident([edge7.end, edge8.start])
  coincident([edge8.end, edge5.start])
}

lowerRegion = region(point = [2mm, 2mm], sketch = lowerProfile)
upperRegion = region(point = [3mm, 1.8mm], sketch = upperProfile)

lofted = loft([lowerRegion, upperRegion])

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft5_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Demonstrates surface lofts with shapes from sketch blocks.
// Loft a square, a circle, and another circle.
sideLen = 4
squareSketch = sketch(on = XY) {
  line1 = line(start = [var -0.02mm, var 4.02mm], end = [var 0mm, var 0mm])
  coincident([line1.end, ORIGIN])
  line2 = line(start = [var 4.02mm, var 0.03mm], end = [var 4.06mm, var 3.97mm])
  line3 = line(start = [var 4.06mm, var 3.97mm], end = [var -0.02mm, var 4.02mm])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.start])
  line4 = line(start = [var 0mm, var 0mm], end = [var 4.02mm, var 0.03mm])
  coincident([line4.start, line1.end])
  coincident([line4.end, line2.start])
  equalLength([line1, line2, line3, line4])
  parallel([line1, line2])
}

circleSketch0 = sketch(on = offsetPlane(XY, offset = 2)) {
  circle1 = circle(start = [var 2.28mm, var 2.99mm], center = [var 1.98mm, var 2.03mm])
}

squareRegion = region(point = [0.0002mm, 2.0095mm], sketch = squareSketch)
circleRegion = region(point = [1.6807mm, 1.0724mm], sketch = circleSketch0)

shape = loft([squareRegion, circleRegion], bodyType = SURFACE)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft6_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Demonstrates surface lofting of segments from multiple sketch blocks.
@settings(defaultLengthUnit = mm, kclVersion = 1.0)

sketch002 = sketch(on = XY) {
  arc1 = arc(start = [var -2.02mm, var -3.05mm], end = [var 2.03mm, var -3.01mm], center = [var 0.01mm, var -3.05mm])
}
sketch003 = sketch(on = -XY) {
  arc1 = arc(start = [var 2.03mm, var 3.05mm], end = [var -2.03mm, var 3.03mm], center = [var 0mm, var 2.94mm])
}

sketch001 = sketch(on = XZ) {
  arc1 = arc(start = [var -2.03mm, var -0.13mm], end = [var 2.03mm, var -0.05mm], center = [var 0mm, var 0mm])
  coincident([arc1.center, ORIGIN])
}

loft(
  [
    sketch003.arc1,
    sketch002.arc1,
    sketch001.arc1
  ],
  bodyType = SURFACE,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the loft function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-loft7_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-loft7.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


