# 3D file viewer

With `zds_project_shell_refactor` enabled, opening a supported foreign geometry
file selects the **3D Viewer** mode. CAD formats use the existing local renderer;
mesh formats and Rhino use streamed scenes. Both share camera controls,
appearance settings, and engine connection recovery. Viewing requires an
authenticated engine connection; local rendering also needs WebGPU support.
This is not an offline file parser.

Mesh-only engine imports do not provide BRep objects for geometry-only GLB
export. OBJ, STL, PLY, glTF/GLB, FBX, and Rhino therefore use the engine's graphics
scene instead of attempting a local GLB export. STEP and other CAD formats keep
local rendering.

The viewer accepts the formats declared by native KCL imports: STEP/STP, STL,
OBJ, glTF/GLB, PLY, FBX/FBXB, Rhino 3DM, ACIS SAT/SAB, CATIA CATPart,
Inventor IPT, Parasolid X_T/X_B, SolidWorks SLDPRT, and NX/Creo PRT (including
versioned Creo `.prt.N` files). Unversioned `.prt` uses the native NX default.
DXF and other formats outside KCL's foreign geometry imports are not claimed.

The toolbar's **KCL destination** selects a file in the current project.
**Insert into KCL** opens or reuses its working buffer, appends a relative import
with a fresh alias, and makes the change undoable. Save the KCL buffer normally;
the action does not write either file to storage. Existing unsaved edits remain.

## Ownership

- The shared executor captures original model bytes plus external `.bin` buffers
  for glTF. Its virtual KCL entrypoint imports the model without writing a file.
- Each view leases that executor and separately owns its scene, camera, native
  runtime, and connection through `kcl/modeling/sceneViews.ts`.
- Each connection delivers asynchronous replies to that runtime's native context.
  Geometry imports wait for this delivery even after their JavaScript pending
  command has settled. Replies bypass the execution/export queue to avoid waiting
  behind the import they complete; disposal drains in-flight deliveries.
- Model formats declare binary backings through `editorFileFormatsFacet`. The
  editor retains original bytes, prohibits edits and text saves, and source capture
  reads binary imports from storage even while their viewers are open.
- Project replacement, tree changes, and executor cancellation invalidate pending
  byte captures. Import insertion checks its captured project again after loading
  the target and never writes into a replacement project.

## Manual smoke test

Enable the project-shell flag and open a project containing a STEP file, a binary
STL or GLB, and a KCL file. Open each model, orbit/zoom, then insert one into the
KCL file. Check its relative import, rendering, undo, and save/reopen behavior.
Repeat with glTF plus an external `.bin`, two views of a model, a nested KCL
destination with unsaved edits, and a project switch during a slow file read.
