---
title: "Solid"
excerpt: "An solid is a collection of extrude surfaces."
layout: manual
---

An solid is a collection of extrude surfaces.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `id` |`string`| The id of the solid. | No |
| `artifactId` |[`ArtifactId`](/docs/kcl/types/ArtifactId)| The artifact ID of the solid.  Unlike `id`, this doesn't change. | No |
| `value` |`[` [`ExtrudeSurface`](/docs/kcl/types/ExtrudeSurface) `]`| The extrude surfaces. | No |
| `sketch` |[`Sketch`](/docs/kcl/types/Sketch)| The sketch. | No |
| `height` |`number`| The height of the solid. | No |
| `startCapId` |`string`| The id of the extrusion start cap | No |
| `endCapId` |`string`| The id of the extrusion end cap | No |
| `edgeCuts` |`[` [`EdgeCut`](/docs/kcl/types/EdgeCut) `]`| Chamfers or fillets on this solid. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| An solid is a collection of extrude surfaces. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`| Metadata. | No |


