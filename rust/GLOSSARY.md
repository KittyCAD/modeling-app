# KCL language

Terminology for describing parametric CAD models in KCL and interpreting their modeling operations.

## Language

### Sketching

**Sketch**:
A collection of two-dimensional geometry on a plane or face. A sketch may contain open curves, closed boundaries, and construction geometry.
_Avoid_: Profile or region for the entire sketch

**Sketch block**:
A KCL construct that declares a sketch's segments and constraints together on a plane or face.

**Segment**:
An individual geometric element in a sketch, such as a point, line, arc, circle, or spline.
_Avoid_: Edge for sketch geometry

**Construction geometry**:
Sketch geometry used as a reference for constraints or positioning, excluded from region boundaries.

**Region**:
A selected area enclosed by a closed boundary in a sketch, used as input to a modeling operation. A sketch may provide several distinct regions.
_Avoid_: Sketch for a selected area

### Constraints

**Sketch variable**:
An adjustable numeric value introduced with `var` inside a sketch block. Its initial value is a guess that may change when satisfying the sketch's constraints.

**Constraint**:
A geometric or dimensional relationship that sketch geometry must satisfy, such as coincidence, tangency, or a specified distance.

### Bodies and topology

**Body**:
A three-dimensional modeling object that may be a solid body or a surface body.
_Avoid_: Solid when a surface body is also possible

**Solid body**:
A body whose boundary encloses a volume.

**Surface body**:
A body made of surfaces without an enclosed volume.

**Face**:
A bounded surface belonging to a body. A face may be planar or curved.

**Edge**:
A boundary curve of a body's face.
_Avoid_: Segment for body topology

**Plane**:
A flat reference surface with an origin and orientation in three-dimensional space, used to position sketches.

### Geometry references

**Tag**:
A name attached to sketch geometry or a body's edge or face so that later KCL expressions can refer to it. A tag on a sketch segment may refer to the face formed from that segment after extrusion.
_Avoid_: Label or string identifier for a geometry reference

**Tag declaration**:
The introduction of a tag name, written with a `$` prefix, at the modeling operation that assigns it to geometry.

### Modeling and interpretation

**Modeling operation**:
A step in a KCL model that creates or modifies geometry, such as an extrusion or fillet.

**Consumed geometry**:
A region or body value that a modeling operation has used up, so the original value is no longer valid as input to another modeling operation.
_Avoid_: Hidden geometry, which concerns visibility

**Modeling engine**:
The CAD system responsible for constructing and querying the geometry described by KCL modeling operations.

**Artifact**:
A record of a modeling entity or operation produced during KCL execution, such as a sketch, face, constraint, or extrusion.
_Avoid_: Build artifact or exported file

**Artifact graph**:
The network of artifacts and their relationships, connecting modeled geometry and modeling operations to the KCL source that produced them.
