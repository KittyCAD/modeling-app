---
title: "ExtrudeGroup"
excerpt: "An extrude group is a collection of extrude surfaces."
layout: manual
---

An extrude group is a collection of extrude surfaces.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `__meta` |`array`| Metadata. | No |
| `edgeCuts` |`array`| Chamfers or fillets on this extrude group. | No |
| `endCapId` |`string` (`uuid`)| The id of the extrusion end cap | No |
| `height` |`number` (`double`)| The height of the extrude group. | No |
| `id` |`string` (`uuid`)| The id of the extrude group. | No |
| `sketchGroup` |`object`| The sketch group. | No |
| `startCapId` |`string` (`uuid`)| The id of the extrusion start cap | No |
| `value` |`array`| The extrude surfaces. | No |


