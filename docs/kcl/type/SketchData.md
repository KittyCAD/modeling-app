---
title: "SketchData"
excerpt: "Data for start sketch on. You can start a sketch on a plane or an extrude group."
layout: manual
---

Data for start sketch on. You can start a sketch on a plane or an extrude group.


**anyOf**



**This schema accepts any of the following:**

Data for a plane.


**oneOf**




**This schema accepts exactly one of the following:**

The XY plane.


**enum:** `XY`

**Type:** `string`







----
The opposite side of the XY plane.


**enum:** `-XY`

**Type:** `string`







----
The XZ plane.


**enum:** `XZ`

**Type:** `string`







----
The opposite side of the XZ plane.


**enum:** `-XZ`

**Type:** `string`







----
The YZ plane.


**enum:** `YZ`

**Type:** `string`







----
The opposite side of the YZ plane.


**enum:** `-YZ`

**Type:** `string`







----
A defined plane.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `plane` | `object`
 |  | No |


----




----
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
| `value` | `array`
 | The extrude surfaces. | No |


----





