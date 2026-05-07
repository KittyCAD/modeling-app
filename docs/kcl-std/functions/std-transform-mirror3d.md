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
  across: Edge | Plane | Axis3d,
): [Solid; 1+]
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `bodies` | [[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+] | The body or bodies to be reflected. | Yes |
| `across` | [`Edge`](/docs/kcl-std/types/std-types-Edge) or [`Plane`](/docs/kcl-std/types/std-types-Plane) or [`Axis3d`](/docs/kcl-std/types/std-types-Axis3d) | The axis (or other geometry) to reflect across. | Yes |

### Returns

[[`Solid`](/docs/kcl-std/types/std-types-Solid); 1+]



