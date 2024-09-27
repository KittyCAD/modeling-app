---
title: "SketchSurfaceOrGroup"
excerpt: "A sketch surface or a sketch group."
layout: manual
---

A sketch surface or a sketch group.



**This schema accepts any of the following:**

A sketch group type.




**This schema accepts exactly one of the following:**

A plane.


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




----
A sketch group is a collection of paths.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `__meta` | `array`
 | Metadata. | No |
| `id` | `string` (`uuid`)
 | The id of the sketch group (this will change when the engine&#x27;s reference to it changes. | No |
| `on` | oneOf
 | What the sketch is on (can be a plane or a face). | No |
| `start` | `object`
 | The starting path. | No |
| `tags` | `object`
 | Tag identifiers that have been declared in this sketch group. | No |
| `value` | `array`
 | The paths in the sketch group. | No |


----





