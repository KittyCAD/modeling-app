# KCL language

Terminology for describing parametric CAD models in KCL and interpreting their
modeling operations.

## Language

### Code blocks

**Code block**:
A group of KCL statements supplied to a function without immediate evaluation.
The receiving function determines how those statements are used.

**Block value**:
A **code block** together with the bindings it captures from its surrounding
scope, available to store or pass between functions without evaluating its
statements.

**Block parameter**:
A function parameter declared to accept a **block value**.

**Trailing block**:
A **code block** written after a function call's arguments and supplied to that
function's **block parameter**.

### Sketching

**Sketch**:
A collection of two-dimensional geometry on a **plane** or **face**. It may
contain open curves, closed boundaries, and **construction geometry**.
_Avoid_: Profile or region for the entire sketch

**Sketch block**:
A KCL construct that declares the **segments** and **constraints** of a
**sketch** on a **plane** or **face**.

**Segment**:
An individual geometric element in a **sketch**, such as a point, line, arc,
circle, or spline.
_Avoid_: Edge for sketch geometry

**Construction geometry**:
Geometry in a **sketch** that can guide **constraints** or positioning and is
excluded from **region** boundaries.

**Region**:
A selected area enclosed by a closed boundary in a **sketch**, used as input to
a **modeling operation**. A **sketch** may provide several distinct **regions**.
_Avoid_: Sketch for a selected area

### Constraints

**Sketch variable**:
An adjustable numeric value introduced with `var` inside a **sketch block**. Its
initial value is a guess that may change to satisfy the **constraints**.

**Constraint**:
A geometric or dimensional relationship that geometry in a **sketch** must
satisfy, such as coincidence, tangency, or a specified distance.

### Bodies and topology

**Body**:
A three-dimensional modeling object that may be either a **solid body** or a
**surface body**.
_Avoid_: Solid when a surface body is also possible

**Solid body**:
A **body** whose boundary encloses a volume.

**Surface body**:
A **body** made of surfaces without an enclosed volume.

**Face**:
A bounded surface on a **body** that may be planar or curved.

**Edge**:
A boundary curve of a **face** on a **body**.
_Avoid_: Segment for body topology

**Plane**:
A flat reference surface with an origin and orientation in three-dimensional
space, used to position **sketches**.

### Geometry references

**Tag**:
A name that later KCL expressions can use to refer to geometry in a **sketch**
or to an **edge** or **face** of a **body**. A **tag** on a **segment** may
refer to the **face** formed from that **segment** after extrusion.
_Avoid_: Label or string identifier for a geometry reference

**Tag declaration**:
A `$`-prefixed name that introduces a **tag** at the **modeling operation** that
assigns it to geometry.

**Edge specifier**:
A KCL reference to one or more **edges** by the **faces** that run along them.
**Faces** touching the ends or an index can narrow the selection.

### Modeling and interpretation

**Modeling operation**:
A step in a KCL model that creates or modifies geometry, such as an extrusion or
fillet.

**Consumed geometry**:
A **region** or **body** value used up by a **modeling operation** and no longer
valid as input to another **modeling operation**.
_Avoid_: Hidden geometry, which concerns visibility

**Modeling engine**:
The CAD system responsible for constructing and querying the geometry described
by KCL **modeling operations**.

**Artifact**:
A record of a modeling entity or **modeling operation** from KCL execution,
such as a **sketch**, **face**, **constraint**, or extrusion.
_Avoid_: Build artifact or exported file

**Artifact graph**:
A network of related **artifacts** that connects modeled geometry and
**modeling operations** to the KCL source that produced them.
