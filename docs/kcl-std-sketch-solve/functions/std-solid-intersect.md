---
title: "intersect"
subtitle: "Function in std::solid"
excerpt: "Intersect returns the shared volume between multiple solids, preserving only overlapping regions."
layout: manual
---

Intersect returns the shared volume between multiple solids, preserving only overlapping regions.

```kcl
intersect(
  @solids: [Solid; 2+],
  tolerance?: number(Length),
  legacyMethod?: bool,
): [Solid; 1+]
```

Intersect computes the geometric intersection of multiple solid bodies,
returning a new solid representing the volume that is common to all input
solids. This operation is useful for determining shared material regions,
verifying fit, and analyzing overlapping geometries in assemblies.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 2+] | The solids to intersect. | Yes |
| `tolerance` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `legacyMethod` | [`bool`](/docs/kcl-std/types/std-types-bool) | You probably shouldn't set this or care about this, it's for opting back into an older version of an engine algorithm. If true, revert to older engine SSI algorithm. Defaults to false. | No |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]



