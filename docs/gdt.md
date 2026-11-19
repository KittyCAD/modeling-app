# GD&T annotation placement in Zoo Design Studio

Select the faces or edges to annotate, then choose a GD&T command from the
toolbar or command search. When placement is omitted, Design Studio uses the
selected geometry's bounding box to choose a frame offset. For faces, it uses
the face normal to choose a perpendicular frame plane and the direction of the
offset. If the normal is unavailable, the bounding box provides a plane when
one axis is clearly thinner than the others.

Text size is estimated from the whole model's bounding box. Subsequent
annotations reuse the last explicit GD&T `fontSize` in the file to keep text
consistent. The generated placement and size are saved in the KCL code.

To adjust an annotation, double-click its operation in the Feature Tree or edit
its KCL arguments:

- `framePosition` sets the two offsets relative to the leader arrow in the frame
  plane. Zero offsets are supported, for example `[5mm, 0mm]`.
- `framePlane` chooses the plane in which the frame appears: `XY`, `XZ`, or `YZ`.
- `fontSize` sets the model-space text size, for example `0.8mm`.

Explicit values are retained when editing the annotation and reopening the
project. Automatic guesses apply when creating annotations through Design
Studio; KCL's optional arguments and language defaults are unchanged. See the
[GD&T reference](kcl-std/modules/std-gdt.md) for each function's arguments.
