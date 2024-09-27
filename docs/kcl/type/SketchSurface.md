---
title: "SketchSurface"
excerpt: "A sketch group type."
layout: manual
---

A sketch group type.


**oneOf**




**This schema accepts exactly one of the following:**

A plane.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `__meta` | `array`
 |  | No |
| `id` | `string` (`uuid`)
 | The id of the plane. | No |
| `origin` | `object`
 | Origin of the plane. | No |
| `type` | enum: `plane`
 |  | No |
| `value` | oneOf
 | Type for a plane. | No |
| `xAxis` | `object`
 | What should the plane’s X axis be? | No |
| `yAxis` | `object`
 | What should the plane’s Y axis be? | No |
| `zAxis` | `object`
 | The z-axis (normal). | No |


----
A face.


`object`

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `__meta` | `array`
 |  | No |
| `extrudeGroup` | `object`
 | The extrude group the face is on. | No |
| `id` | `string` (`uuid`)
 | The id of the face. | No |
| `type` | enum: `face`
 |  | No |
| `value` | `string`
 | The tag of the face. | No |
| `xAxis` | `object`
 | What should the face’s X axis be? | No |
| `yAxis` | `object`
 | What should the face’s Y axis be? | No |
| `zAxis` | `object`
 | The z-axis (normal). | No |


----




