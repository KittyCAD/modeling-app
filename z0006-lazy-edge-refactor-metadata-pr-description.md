This is a follow-up to the Z0006 lint work. The main change is that deprecated edge helper execution no longer eagerly asks the engine for adjacent face IDs while the KCL program is running.

Instead, execution records the cheap bits we already have: the resolved edge ID, the owning object ID where available, the source range, and which deprecated stdlib helper produced it. Then the TypeScript lint action hydrates the missing face IDs later, only when we actually need to apply the Z0006 autofix.

The motivation is mostly keeping execution lighter. The old path made extra `solid3d_get_all_edge_faces` calls while running old syntax, which means just having deprecated syntax in a file could slow execution down. This moves that work into the lint/refactor path, where the user has actually asked for the fix.

What changed:

- `EdgeRefactorMeta` now has optional `objectId` and optional `faceIds`.
- Deprecated helpers like `getOppositeEdge`, adjacent edge helpers, and `edgeId` record lazy metadata without fetching faces immediately.
- `fillet` and `chamfer` still attach the solid object ID when they consume one of those edge refs.
- The lint/refactor action hydrates missing `faceIds` after execution using the engine command manager.
- The codemod skips unhydrated entries rather than assuming face IDs are always present.

Direct tag metadata is intentionally left eager, because that path is different: direct `tags = [...]` on `fillet` / `chamfer` needs tag-specific face metadata, not just the deprecated helper edge ID.
