---
title: "subtract"
subtitle: "Function in std::solid"
excerpt: "Subtract removes tool solids from base solids, leaving the remaining material."
layout: manual
---

Subtract removes tool solids from base solids, leaving the remaining material.

```kcl
subtract(
  @solids: [Solid; 1+],
  tools: [Solid],
  tolerance?: number(Length),
  legacyMethod?: bool,
): [Solid; 1+]
```

Performs a bool subtraction operation, removing the volume of one or more
tool solids from one or more base solids. The result is a new solid
representing the material that remains after all tool solids have been cut
away. This function is essential for machining simulations, cavity creation,
and complex multi-body part modeling.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `solids` | `[Solid; 1+]` | The solids to use as the base to subtract from. | Yes |
| `tools` | `[Solid]` | The solids to subtract. | Yes |
| `tolerance` | `number(Length)` | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |
| `legacyMethod` | `bool` | You probably shouldn't set this or care about this, it's for opting back into an older version of an engine algorithm. If true, revert to older engine SSI algorithm. Defaults to false. | No |

### Returns

`[Solid; 1+]`



