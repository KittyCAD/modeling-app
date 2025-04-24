---
title: "GeometryWithImportedGeometry"
excerpt: "A geometry including an imported geometry."
layout: manual
---

A geometry including an imported geometry.





**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Sketch`](/docs/kcl/types/Sketch)|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the sketch (this will change when the engine's reference to it changes). | No |
| `paths` |`[` [`Path`](/docs/kcl/types/Path) `]`| The paths in the sketch. | No |
| `on` |[`SketchSurface`](/docs/kcl/types/SketchSurface)| What the sketch is on (can be a plane or a face). | No |
| `start` |[`BasePath`](/docs/kcl/types/BasePath)| The starting path. | No |
| `tags` |`object`| Tag identifiers that have been declared in this sketch. | No |
| `artifactId` |[`string`](/docs/kcl/types/string)| The original id of the sketch. This stays the same even if the sketch is is sketched on face etc. | No |
| `originalId` |[`string`](/docs/kcl/types/string)|  | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Solid`](/docs/kcl/types/Solid)|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the solid. | No |
| `artifactId` |[`string`](/docs/kcl/types/string)| The artifact ID of the solid.  Unlike `id`, this doesn't change. | No |
| `value` |`[` [`ExtrudeSurface`](/docs/kcl/types/ExtrudeSurface) `]`| The extrude surfaces. | No |
| `sketch` |[`Sketch`](/docs/kcl/types/Sketch)| The sketch. | No |
| `height` |[`number`](/docs/kcl/types/number)| The height of the solid. | No |
| `startCapId` |[`string`](/docs/kcl/types/string)| The id of the extrusion start cap | No |
| `endCapId` |[`string`](/docs/kcl/types/string)| The id of the extrusion end cap | No |
| `edgeCuts` |`[` [`EdgeCut`](/docs/kcl/types/EdgeCut) `]`| Chamfers or fillets on this solid. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| The units of the solid. | No |
| `sectional` |`boolean`| Is this a sectional solid? | No |


----
Data for an imported geometry.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ImportedGeometry`|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The ID of the imported geometry. | No |
| `value` |`[` [`string`](/docs/kcl/types/string) `]`| The original file paths. | No |


----




