---
title: "SketchData"
excerpt: "Data for start sketch on. You can start a sketch on a plane or an solid."
layout: manual
---

Data for start sketch on. You can start a sketch on a plane or an solid.



**This schema accepts any of the following:**

Data for a plane.








----
An solid is a collection of extrude surfaces.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `id` |`string`| The id of the solid. | No |
| `value` |`[` **oneOf:** `object` **OR** `object` **OR** `object` **OR** `object` `]`| The extrude surfaces. | No |
| `sketch` |`object`| The sketch. | No |
| `height` |`number`| The height of the solid. | No |
| `startCapId` |`string`| The id of the extrusion start cap | No |
| `endCapId` |`string`| The id of the extrusion end cap | No |
| `edgeCuts` |`[` **oneOf:** `object` **OR** `object` `]`| Chamfers or fillets on this solid. | No |
| `__meta` |`[` `object` `]`| Metadata. | No |


----





