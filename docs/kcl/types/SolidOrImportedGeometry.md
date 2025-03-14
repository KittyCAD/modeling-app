---
title: "SolidOrImportedGeometry"
excerpt: "Data for a solid or an imported geometry."
layout: manual
---

Data for a solid or an imported geometry.





**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `solid`|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the solid. | No |
| `artifactId` |[`ArtifactId`](/docs/kcl/types/ArtifactId)| The artifact ID of the solid.  Unlike `id`, this doesn't change. | No |
| `value` |`[` [`ExtrudeSurface`](/docs/kcl/types/ExtrudeSurface) `]`| The extrude surfaces. | No |
| `sketch` |[`Sketch`](/docs/kcl/types/Sketch)| The sketch. | No |
| `height` |[`number`](/docs/kcl/types/number)| The height of the solid. | No |
| `startCapId` |[`string`](/docs/kcl/types/string)| The id of the extrusion start cap | No |
| `endCapId` |[`string`](/docs/kcl/types/string)| The id of the extrusion end cap | No |
| `edgeCuts` |`[` [`EdgeCut`](/docs/kcl/types/EdgeCut) `]`| Chamfers or fillets on this solid. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |


----
Data for an imported geometry.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `importedGeometry`|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The ID of the imported geometry. | No |
| `value` |`[` [`string`](/docs/kcl/types/string) `]`| The original file paths. | No |


----

**Type:** `[object, array]`

`[` [`Solid`](/docs/kcl/types/Solid) `]`



## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `solidSet`|  | No |


----




