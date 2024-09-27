---
title: "ExtrudeGroupSet"
excerpt: "A extrude group or a group of extrude groups."
layout: manual
---

A extrude group or a group of extrude groups.


**oneOf**




**This schema accepts exactly one of the following:**

An extrude group is a collection of extrude surfaces.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `__meta` | `array`
 | Metadata. | No |
| `edgeCuts` | `array`
 | Chamfers or fillets on this extrude group. | No |
| `endCapId` | `string` (`uuid`)
 | The id of the extrusion end cap | No |
| `height` | `number` (`double`)
 | The height of the extrude group. | No |
| `id` | `string` (`uuid`)
 | The id of the extrude group. | No |
| `sketchGroup` | `object`
 | The sketch group. | No |
| `startCapId` | `string` (`uuid`)
 | The id of the extrusion start cap | No |
| `type` | enum: `extrudeGroup`
 |  | No |
| `value` | `array`
 | The extrude surfaces. | No |


----


`[object, array]`

**Type:** `[object, array]`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` | enum: `extrudeGroups`
 |  | No |


----




