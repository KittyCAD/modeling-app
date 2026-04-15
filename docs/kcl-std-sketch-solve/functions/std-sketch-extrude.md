---
title: "extrude"
subtitle: "Function in std::sketch"
excerpt: "Extend a 2-dimensional sketch or individual segment of a sketch through a third dimension to create a new 3-dimensional volume or surface, or if extruded into an existing volume, cut into an existing solid."
layout: manual
---

Extend a 2-dimensional sketch or individual segment of a sketch through a third dimension to create a new 3-dimensional volume or surface, or if extruded into an existing volume, cut into an existing solid.

```kcl
extrude(
  @sketches: [Sketch | Face | TaggedFace | Segment; 1+],
  length?: number(Length),
  to?: Point3d | Axis3d | Plane | Edge | Face | Sketch | Solid | TaggedEdge | TaggedFace,
  symmetric?: bool,
  bidirectionalLength?: number(Length),
  tagStart?: TagDecl,
  tagEnd?: TagDecl,
  twistAngle?: number(Angle),
  twistAngleStep?: number(Angle),
  twistCenter?: Point2d,
  method?: string,
  hideSeams?: bool,
  bodyType?: string,
): [Solid; 1+]
```

You can provide more than one sketch to extrude, and they will all be
extruded in the same direction.

When you sketch on a face of a solid, extruding extends or cuts into the
existing solid, meaning you don't need to union or subtract the volumes. You
can change this behavior by using the `method` parameter. See
sketch on face for more details.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketches` | `[Sketch | Face | TaggedFace | Segment; 1+]` | Which sketch or sketches should be extruded. | Yes |
| `length` | `number(Length)` | How far to extrude the given sketches. Incompatible with `to`. | No |
| `to` | `Point3d | Axis3d | Plane | Edge | Face | Sketch | Solid | TaggedEdge | TaggedFace` | Reference to extrude to. Incompatible with `length` and `twistAngle`. | No |
| `symmetric` | `bool` | If true, the extrusion will happen symmetrically around the sketch. Otherwise, the extrusion will happen on only one side of the sketch. | No |
| `bidirectionalLength` | `number(Length)` | If specified, will also extrude in the opposite direction to 'distance' to the specified distance. If 'symmetric' is true, this value is ignored. | No |
| `tagStart` | `TagDecl` | A named tag for the face at the start of the extrusion, i.e. the original sketch. | No |
| `tagEnd` | `TagDecl` | A named tag for the face at the end of the extrusion, i.e. the new face created by extruding the original sketch. | No |
| `twistAngle` | `number(Angle)` | If given, the sketch will be twisted around this angle while being extruded. Incompatible with `to`. | No |
| `twistAngleStep` | `number(Angle)` | The size of each intermediate angle as the sketch twists around. Must be between 4 and 90 degrees. Only used if `twistAngle` is given, defaults to 15 degrees. | No |
| `twistCenter` | `Point2d` | The center around which the sketch will be twisted. Relative to the plane's origin. Only used if `twistAngle` is given, defaults to [0, 0] i.e. plane origin. | No |
| `method` | `string` | The method used during extrusion, either `NEW` or `MERGE`. `NEW` creates a new object. `MERGE` merges the extruded objects together. The default is `MERGE`. | No |
| `hideSeams` | `bool` | Whether or not to hide the seams between the original and resulting object. Only used if a face is extruded and method = MERGE | No |
| `bodyType` | `string` | What type of body to produce (solid or surface). Defaults to "solid". | No |

### Returns

`[Solid; 1+]`


### Examples

```kcl
profile = sketch(on = XY) {
  edge1 = line(start = [var 0mm, var 0mm], end = [var 5mm, var 0mm])
  edge2 = line(start = [var 5mm, var 0mm], end = [var 5mm, var 3mm])
  edge3 = line(start = [var 5mm, var 3mm], end = [var 0mm, var 3mm])
  edge4 = line(start = [var 0mm, var 3mm], end = [var 0mm, var 0mm])
  coincident([edge1.end, edge2.start])
  coincident([edge2.end, edge3.start])
  coincident([edge3.end, edge4.start])
  coincident([edge4.end, edge1.start])
  horizontal(edge1)
  vertical(edge2)
  horizontal(edge3)
  vertical(edge4)
}

solid = extrude(region(point = [2mm, 1mm], sketch = profile), length = 5)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude13_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude13.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>

```kcl
// Sketch some disconnected lines in a sketch block.
originalSketch = sketch(on = YZ) {
  line1 = line(start = [var -5.33mm, var 3.69mm], end = [var -5.93mm, var -2.59mm])
  line2 = line(start = [var -0.9mm, var 0.63mm], end = [var 4.01mm, var 0.68mm])
}

// Surface extrudes of sketch blocks let you extrude any lines.
extrude(
  [
    originalSketch.line1,
    originalSketch.line2
  ],
  length = 1,
  bodyType = SURFACE,
)

// Surface extrudes of sketch blocks are non-destructive: they leave the original sketch
// in place. So we can add another extrude of the same lines, in a different direction.
extrude(
  [
    originalSketch.line1,
    originalSketch.line2
  ],
  length = -1,
  bodyType = SURFACE,
)

```


<model-viewer
  class="kcl-example"
  alt="Example showing a rendered KCL program that uses the extrude function"
  src="/kcl-test-outputs/models/serial_test_example_fn_std-sketch-extrude14_output.gltf"
  ar
  environment-image="/moon_1k.hdr"
  poster="/kcl-test-outputs/serial_test_example_fn_std-sketch-extrude14.png"
  shadow-intensity="1"
  camera-controls
  touch-action="pan-y"
>
</model-viewer>


