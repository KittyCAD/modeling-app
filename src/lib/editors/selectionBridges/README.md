# Selection bridges between editor views

The registry composes a generic connection owner and domain-specific adapters.
The generic owner never receives source ranges, geometry, solver IDs, or a global
selection store. Endpoints keep their selection data and interpreting adapters
retain their own typed input/output APIs.

Contribute `EditorSelectionBridgeDefinition` through
`editorSelectionBridgeDefinitions`: give the bridge an ID, a source endpoint
kind, a target kind, and an explicit same-buffer auto-link policy. For example,
a diagram extension can connect `diagram.source` and `diagram.canvas`; a KCL
drawing extension can supply a separate pair without changing this owner.

Providers register view ID, backing editor ID, kind, and optional enabled signal
through `editorSelectionEndpointsService`. A view can register different kinds
independently. Keep the returned cleanup with that provider's lifetime.

Consumers obtain `editorSelectionLinksService` to inspect enabled connections,
create explicit links, or choose a picking destination. Every call names the
bridge ID. One connected target is the default destination; multiple targets
require an explicit choice, regardless of focus or which dialog happens to be
open. Disabled endpoints cannot receive picks. Closing endpoints removes their
explicit links and destination choices. Withdrawing a bridge definition removes
its connections and explicit intent; adding it again does not revive old links.

The KCL correspondence adapter is one independently composed registry factory.
It queries execution-qualified artifacts and owns CodeMirror decorations. Those
domain behaviors are deliberately outside the generic routing service.
