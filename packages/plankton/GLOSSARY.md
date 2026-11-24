# Plankton

Plankton assembles application extensions and manages the resources they share.

## Language

**Facet**:
A named contract for combining ordered contributions into one result, including the result when there are no contributions.

**Binding**:
A declaration that supplies a source of contributions to a Facet.

**Service**:
A contract for a capability supplied by at most one selected provider. A conflict identifies the providers competing to supply it.

**Factory**:
A declaration of resources to acquire, their constructor dependencies, and the exports available to dependents.

**Instance**:
The result of acquiring a Factory in a Registry. It owns its exports, children, and lifecycle callbacks.

**Observation**:
A live view of a Facet or Service that follows the Registry's published configuration.

**Published graph**:
The configuration visible to observations after the Registry commits an acquisition.

**Slot**:
A Factory whose role is to own a replaceable group of extensions.
