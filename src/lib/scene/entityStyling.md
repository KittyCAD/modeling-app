# Entity styling

`createEntityStyling()` gives a scene owner a reset/disposal boundary and a small
`EntityStyling` service to lend to consumers. Consumers acquire independently
owned group handles. Each group specifies rendered entity references, an sRGB
color, fill and outline opacity, line width in screen pixels, and priority.

Higher-priority groups win a shared rendered target. Equal-priority groups use
creation order, with later groups winning; replacing a group's targets or
appearance does not move its position. Disposing the winning group reveals any
lower-priority group. The renderer treats IDs as opaque and knows nothing about
selection, hover, editor views, or correspondence.

`createGroup(style)` and `handle.set(entities)` return an Error when invalid or
expired. `clear()` empties a group without changing its order. `dispose()` removes
only that lease. Resetting or disposing the scene expires all previous handles;
callers must acquire a new handle against the current scene. Caller-owned entity
arrays are copied rather than retained as mutable input.

A local presentation receives the read-only groups through
`LocalRendererHost.entityStyles`. It resolves entity references against the
current mesh/plane/edge maps and artifact graph without sending selection
commands. Unknown targets are omitted rather than converted to neighboring
geometry. Anonymous topological edge/vertex references still need richer local
target mapping; ID-backed curve/edge references are supported.

`EntityStylingRenderer` borrows target geometry and owns masks, overlay objects,
and materials. It resolves overlap before drawing, preserving the cached base
frame. Its straight-alpha conversion is explicit: configured opacity must match
normal display blending. `SelectionHighlightRenderer` is the application adapter
that supplies existing selection/hover colors and priorities; consumers can
supply other styles through the same generic core.

GPU smoke verification should check two differently colored low-opacity groups,
a higher-priority overlapping group, removal revealing the lower group, and a
scene reset leaving no styles. Verify faces and lines in both light and dark
themes. Unit tests cover lease isolation/expiration, ordering, target resolution,
and disposal without freeing source geometry.
