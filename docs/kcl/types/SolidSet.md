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
| `id` |`string` (`uuid`)| The id of the solid. | No |
| `value` |`array`| The extrude surfaces. | No |
| `sketch` |`object`| The sketch. | No |
| `height` |`number` (`double`)| The height of the solid. | No |
| `startCapId` |`string` (`uuid`)| The id of the extrusion start cap | No |
| `endCapId` |`string` (`uuid`)| The id of the extrusion end cap | No |
| `edgeCuts` |`array`| Chamfers or fillets on this solid. | No |
| `__meta` |`array`| Metadata. | No |


----


**Type:** `[object, array]`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `solids`|  | No |


----




