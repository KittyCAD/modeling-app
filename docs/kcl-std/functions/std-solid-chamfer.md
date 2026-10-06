---
title: "chamfer"
subtitle: "Function in std::solid"
excerpt: "Cut a straight transitional edge along a tagged path."
layout: manual
---

Cut a straight transitional edge along a tagged path.

```kcl
chamfer(
  @solid: Solid,
  length: number(Length),
  tags?: [Edge; 1+],
  edges?: [any],
  secondLength?: number(Length),
  angle?: number(Angle),
  tag?: TagDecl,
  legacyMethod?: bool,
  version?: number(_),
  tangentChain?: bool,
): Solid
```

Chamfer is similar in function and use to a fillet, except
a fillet will blend the transition along an edge, rather than cut
a sharp, straight transitional edge.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solid` | [`Solid`](/docs/kcl-std/types/std-types-Solid) | The solid whose edges should be chamfered | Yes |
| `length` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Chamfering cuts away two faces to create a third face. This is the length to chamfer away from each face. The larger this length to chamfer away, the larger the new face will be. | Yes |
| `tags` | [[`Edge`](/docs/kcl-std/types/std-types-Edge); 1+] | The paths you want to chamfer (legacy API) | No |
| `edges` | [[`any`](/docs/kcl-std/types/std-types-any)] | Array of edge references; each element is an object with: - `sideFaces`: [Face \| Tag; 1+] - Adjacent faces that share the edge(s) to chamfer - `endFaces?`: [Face \| Tag] - Optional faces to disambiguate when multiple edges share the same two faces - `index?`: number(Count) - Optional index when multiple edges share the same faces (0-based) | No |
| `secondLength` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Chamfering cuts away two faces to create a third face. If this argument isn't given, the lengths chamfered away from both the first and second face are both given by `length`. If this argument _is_ given, it determines how much is cut away from the second face. Incompatible with `angle`. | No |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | Chamfering cuts away two faces to create a third face. This argument determines the angle between the two cut edges. Requires `length`, incompatible with `secondLength`. The valid range is 0deg < angle < 90deg. | No |
| `tag` | [`TagDecl`](/docs/kcl-std/types/std-types-TagDecl) | Create a new tag which refers to this chamfer | No |
| `legacyMethod` | [`bool`](/docs/kcl-std/types/std-types-bool) | **Deprecated as of KCL 2.0.** **Removed in KCL 3.0.** You probably shouldn't set this or care about this, it's for opting back into an older version of an engine algorithm. If true, revert to older engine SSI algorithm. Defaults to false. | No |
| `version` | [`number(_)`](/docs/kcl-std/types/std-types-number) | **Removed in KCL 3.0.** **Experimental.** What version of the fillet algorithm to use. 0 means "let the Zoo engine choose whichever version is best", 1 is the original Zoo fillet algorithm, 2 is the newer algorithm (supports rolling ball fillets). On KCL 2.0 and before, the default is 1. KCL 3.0 and later always use the newest algorithm. | No |
| `tangentChain` | [`bool`](/docs/kcl-std/types/std-types-bool) | **Added in KCL 3.0.** If true, also chamfer edges that are tangent to the selected edges. Defaults to true. | No |

### Returns

[`Solid`](/docs/kcl-std/types/std-types-Solid) - A solid is a collection of extruded surfaces.


### Examples

```kcl
// Chamfer a mounting plate.
@settings(kclVersion = 3.0)

width = 20
length = 10
thickness = 1
chamferLength = 2

plateSketch = sketch(on = XY) {
  line1 = line(start = [var -10mm, var -5mm], end = [var 10mm, var -5mm])
  line2 = line(start = [var 10mm, var -5mm], end = [var 10mm, var 5mm])
  line3 = line(start = [var 10mm, var 5mm], end = [var -10mm, var 5mm])
  line4 = line(start = [var -10mm, var 5mm], end = [var -10mm, var -5mm])
}

plateRegion = region(segments = [plateSketch.line4, plateSketch.line1])
plate = extrude(plateRegion, length = thickness, tagEnd = $capEnd001)

cornerChamfer = chamfer(
  plate,
  edges = [
    {
      sideFaces = [
        plateRegion.tags.line1,
        plateRegion.tags.line2
      ]
    },
    {
      sideFaces = [
        plateRegion.tags.line2,
        plateRegion.tags.line3
      ]
    },
    {
      sideFaces = [
        plateRegion.tags.line3,
        plateRegion.tags.line4
      ]
    },
    {
      sideFaces = [
        plateRegion.tags.line4,
        plateRegion.tags.line1
      ]
    }
  ],
  length = chamferLength,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer0_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer0.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Specify a custom chamfer angle.
@settings(kclVersion = 3.0)

cubeSide = 20mm

squareSketch = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 20mm, var 0mm])
  line2 = line(start = [var 20mm, var 0mm], end = [var 20mm, var 20mm])
  line3 = line(start = [var 20mm, var 20mm], end = [var 0mm, var 20mm])
  line4 = line(start = [var 0mm, var 20mm], end = [var 0mm, var 0mm])
  coincident([line1.end, line2.start])
  coincident([line2.end, line3.start])
  coincident([line3.end, line4.start])
  coincident([line4.end, line1.start])
  parallel([line2, line4])
  parallel([line3, line1])
  perpendicular([line1, line2])
  horizontal(line3)
  coincident([line1.start, ORIGIN])
  equalLength([line2, line3])
  distance([line2.start, line2.end]) == cubeSide
}
hide(squareSketch)
squareRegion = region(segments = [squareSketch.line1, squareSketch.line2])
cube = extrude(squareRegion, length = cubeSide, tagEnd = $capEnd001)
chamferOnCube = chamfer(
  cube,
  edges = [
    {
      sideFaces = [
        squareRegion.tags.line1,
        cube.faces.capEnd001
      ]
    }
  ],
  length = 10,
  angle = 30deg,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer1_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer1.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// An example of tangent chaining chamfers
@settings(kclVersion = 3.0)

depth = 4
width = 5
chamferLength = 1

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  coincident([line1.start, ORIGIN])
  horizontal([line1.end, ORIGIN])
  arc1 = arc(start = [var 5mm, var 0mm], end = [var 5mm, var 4mm], center = [var 5mm, var 2mm])
  coincident([line1.end, arc1.start])
  tangent([line1, arc1])
  line2 = line(start = [var 5mm, var 4mm], end = [var 0mm, var 4mm])
  coincident([line2.start, arc1.end])
  vertical([line2.end, ORIGIN])
  line3 = line(start = [var 0mm, var 4mm], end = [var 0mm, var 0mm])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.start])
  horizontal(line2)
  tangent([line2, arc1])
  distance([line3.start, line3.end]) == depth
  distance([line2.start, line2.end]) == width
  equalLength([line1, line2])
}
hidden001 = hide(sketch001)
region001 = region(segments = [sketch001.line1, sketch001.arc1])
extrude001 = extrude(region001, length = depth, tagEnd = $capEnd001)

chamfer001 = chamfer(
  extrude001,
  edges = [
    {
      sideFaces = [
        region001.tags.line1,
        extrude001.faces.capEnd001
      ]
    },
    {
      sideFaces = [
        region001.tags.line3,
        extrude001.faces.capEnd001
      ]
    }
  ],
  length = chamferLength,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer2_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer2.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// The same as the last example, except with tangent chaining disabled
@settings(kclVersion = 3.0)

depth = 4
width = 5
chamferLength = 1

sketch001 = sketch(on = XY) {
  line1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  coincident([line1.start, ORIGIN])
  horizontal([line1.end, ORIGIN])
  arc1 = arc(start = [var 5mm, var 0mm], end = [var 5mm, var 4mm], center = [var 5mm, var 2mm])
  coincident([line1.end, arc1.start])
  tangent([line1, arc1])
  line2 = line(start = [var 5mm, var 4mm], end = [var 0mm, var 4mm])
  coincident([line2.start, arc1.end])
  vertical([line2.end, ORIGIN])
  line3 = line(start = [var 0mm, var 4mm], end = [var 0mm, var 0mm])
  coincident([line2.end, line3.start])
  coincident([line3.end, line1.start])
  horizontal(line2)
  tangent([line2, arc1])
  distance([line3.start, line3.end]) == depth
  distance([line2.start, line2.end]) == width
  equalLength([line1, line2])
}
hidden001 = hide(sketch001)
region001 = region(segments = [sketch001.line1, sketch001.arc1])
extrude001 = extrude(region001, length = depth, tagEnd = $capEnd001)

chamfer001 = chamfer(
  extrude001,
  edges = [
    {
      sideFaces = [
        region001.tags.line1,
        extrude001.faces.capEnd001
      ]
    },
    {
      sideFaces = [
        region001.tags.line3,
        extrude001.faces.capEnd001
      ]
    }
  ],
  length = chamferLength,
  tangentChain = false,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer3_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer3.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// An example of chamfers with KCL 3.0 syntax.
@settings(defaultLengthUnit = mm, kclVersion = 3.0)

// Chamfer the top circular edge of an extruded 8 mm shaft.
// These two shafts show edge selection by a side face and end face.

// Sketch two circles, one on the left, one on the right.
// We'll use them for shafts below.
leftShaftSketch = sketch(on = XY) {
  leftCircle = circle(start = [var -8mm, var 0mm], center = [var -12mm, var 0mm])
  radius(leftCircle) == 4mm
}
rightShaftSketch = sketch(on = XY) {
  rightCircle = circle(start = [var 16mm, var 0mm], center = [var 12mm, var 0mm])
  radius(rightCircle) == 4mm
}

// For each sketch, get the region inside its circle.
leftRegion = region(segments = [leftShaftSketch.leftCircle])
rightRegion = region(segments = [rightShaftSketch.rightCircle])

// Extrude one circle into a shaft,
// then use `leftRegion.tags.leftCircle` to reference the original circle
// at the base of the shaft,
// The end face selects the circular edge at the top of the shaft.
leftShaftBase = extrude(leftRegion, length = 20mm, tagEnd = $leftShaftTop)
leftShaft = leftShaftBase
  |> chamfer(
       length = 1mm,
       edges = [
         {
           sideFaces = [
             leftRegion.tags.leftCircle,
             leftShaftBase.faces.leftShaftTop
           ]
         }
       ],
     )

// Extrude the other circle into a shaft and tag its top end face.
rightShaftBase = extrude(rightRegion, length = 20mm, tagEnd = $rightShaftTop)

// After extrusion, the circle identifies the cylindrical side face.
// Their shared edge is the top rim.
rightShaft = chamfer(
  rightShaftBase,
  length = 1mm,
  edges = [
    {
      sideFaces = [
        rightRegion.tags.rightCircle,
        rightShaftBase.faces.rightShaftTop
      ]
    }
  ],
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer4_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer4.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Chamfer a mounting plate with KCL 1.0 syntax.
width = 20
length = 10
thickness = 1
chamferLength = 2

mountingPlateSketch = startSketchOn(XY)
  |> startProfile(at = [-width / 2, -length / 2])
  |> line(endAbsolute = [width / 2, -length / 2], tag = $edge1)
  |> line(endAbsolute = [width / 2, length / 2], tag = $edge2)
  |> line(endAbsolute = [-width / 2, length / 2], tag = $edge3)
  |> close(tag = $edge4)

mountingPlate = extrude(mountingPlateSketch, length = thickness)
  |> chamfer(
       length = chamferLength,
       tags = [
         getNextAdjacentEdge(edge1),
         getNextAdjacentEdge(edge2),
         getNextAdjacentEdge(edge3),
         getNextAdjacentEdge(edge4)
       ],
     )

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer5_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer5.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch on the face of a chamfer with KCL 1.0 syntax.
fn cube(pos, scale) {
  sg = startSketchOn(XY)
    |> startProfile(at = pos)
    |> line(end = [0, scale])
    |> line(end = [scale, 0])
    |> line(end = [0, -scale])

  return sg
}

part001 = cube(pos = [0, 0], scale = 20)
  |> close(tag = $line1)
  |> extrude(length = 20)
  // We tag the chamfer to reference it later.
  |> chamfer(length = 10, tags = [getOppositeEdge(line1)], tag = $chamfer1)

sketch001 = startSketchOn(part001, face = chamfer1)
  |> startProfile(at = [10, 10])
  |> line(end = [2, 0])
  |> line(end = [0, 2])
  |> line(end = [-2, 0])
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
  |> extrude(length = 10)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the chamfer function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-solid-chamfer6_output.glb"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-solid-chamfer6.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


