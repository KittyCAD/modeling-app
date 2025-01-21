---
title: "SolidSet"
excerpt: "A solid or a group of solids."
layout: manual
---

A solid or a group of solids.





**This schema accepts exactly one of the following:**

An solid is a collection of extrude surfaces.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `solid`|  | No |
| `id` |`string`| The id of the solid. | No |
| `value` |`[` [`ExtrudeSurface`](/docs/kcl/types/ExtrudeSurface) `]`| The extrude surfaces. | No |
| `sketch` |[`Sketch`](/docs/kcl/types/Sketch)| The sketch. | No |
| `height` |`number`| The height of the solid. | No |
| `startCapId` |`string`| The id of the extrusion start cap | No |
| `endCapId` |`string`| The id of the extrusion end cap | No |
| `edgeCuts` |`[` [`EdgeCut`](/docs/kcl/types/EdgeCut) `]`| Chamfers or fillets on this solid. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A solid or a group of solids. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`| Metadata. | No |


----

**Type:** `[object, array]`

`[` [`Solid`](/docs/kcl/types/Solid) `]`



## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `solids`|  | No |


----




