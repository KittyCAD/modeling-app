---
title: "mirror3d"
subtitle: "Function in std::transform"
excerpt: "Create a mirror image of a 3D solid/surface/body, across some specified mirror axis."
layout: manual
---

Create a mirror image of a 3D solid/surface/body, across some specified mirror axis.

```kcl
mirror3d(
  @bodies: [Solid; 1+],
  across: Edge | Plane | Axis3d | Segment,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `bodies` | `[Solid; 1+]` | The body or bodies to be reflected. | Yes |
| `across` | `Edge | Plane | Axis3d | Segment` | The axis (or other geometry) to reflect across. | Yes |

### Returns

`[Solid; 1+]`



