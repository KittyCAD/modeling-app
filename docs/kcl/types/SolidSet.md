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
| `__meta` |`array`| Metadata. | No |
| `edgeCuts` |`array`| Chamfers or fillets on this solid. | No |
| `endCapId` |`string` (`uuid`)| The id of the extrusion end cap | No |
| `height` |`number` (`double`)| The height of the solid. | No |
| `id` |`string` (`uuid`)| The id of the solid. | No |
| `sketch` |`object`| The sketch. | No |
| `startCapId` |`string` (`uuid`)| The id of the extrusion start cap | No |
| `type` |enum: `solid`|  | No |
| `value` |`array`| The extrude surfaces. | No |


----


**Type:** `[object, array]`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `solids`|  | No |


----




