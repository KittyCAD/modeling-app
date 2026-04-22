---
title: "union"
subtitle: "Function in std::solid"
excerpt: "Union two or more solids into a single solid."
layout: manual
---

Union two or more solids into a single solid.

```kcl
union(
  @solids: [Solid; 2+],
  tolerance?: number(Length),
  legacyMethod?: bool,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | `[Solid; 2+]` | The solids to union. | Yes |
| `tolerance` | `number(Length)` | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `legacyMethod` | `bool` | You probably shouldn't set this or care about this, it's for opting back into an older version of an engine algorithm. If true, revert to older engine SSI algorithm. Defaults to false. | No |

### Returns

`[Solid; 1+]`



