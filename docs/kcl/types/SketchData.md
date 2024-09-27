---
title: "SketchData"
excerpt: "Data for start sketch on. You can start a sketch on a plane or an solid."
layout: manual
---

Data for start sketch on. You can start a sketch on a plane or an solid.



**This schema accepts any of the following:**

Data for a plane.




**This schema accepts exactly one of the following:**

The XY plane.


**enum:** `XY`






----
The opposite side of the XY plane.


**enum:** `-XY`






----
The XZ plane.


**enum:** `XZ`






----
The opposite side of the XZ plane.


**enum:** `-XZ`






----
The YZ plane.


**enum:** `YZ`






----
The opposite side of the YZ plane.


**enum:** `-YZ`






----
A defined plane.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `plane` |`object`|  | No |


----




----
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
| `value` |`array`| The extrude surfaces. | No |


----





