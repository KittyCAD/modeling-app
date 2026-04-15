---
title: "joinSurfaces"
subtitle: "Function in std::solid"
excerpt: "Join multiple surfaces together into one body, or join together the results of a split into one body"
layout: manual
---

Join multiple surfaces together into one body, or join together the results of a split into one body

```kcl
joinSurfaces(
  @selection: [Solid; 1+],
  tolerance?: number(Length),
): Solid
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `selection` | `[Solid; 1+]` | The bodies to join together | Yes |
| `tolerance` | `number(Length)` | Defines the smallest distance below which two entities are considered coincident, intersecting, coplanar, or similar. For most use cases, it should not be changed from its default value of 10^-7 millimeters. | No |

### Returns

`Solid` - A solid is a collection of extruded surfaces.



