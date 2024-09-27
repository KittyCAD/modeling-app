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
| `id` |`string` (`uuid`)| The id of the solid. | No |
| `value` |`array`| The extrude surfaces. | No |
| `sketch` |`object`| The sketch. | No |
| `height` |`number` (`double`)| The height of the solid. | No |
| `startCapId` |`string` (`uuid`)| The id of the extrusion start cap | No |
| `endCapId` |`string` (`uuid`)| The id of the extrusion end cap | No |
| `edgeCuts` |`array`| Chamfers or fillets on this solid. | No |
| `__meta` |`array`| Metadata. | No |


