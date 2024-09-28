---
title: "SketchOrSurface"
excerpt: "A sketch surface or a sketch."
layout: manual
---

A sketch surface or a sketch.





**This schema accepts any of the following:**

A sketch type.






**This schema accepts exactly one of the following:**

A plane.



**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `plane`|  | No |
| `id` |`string`| The id of the plane. | No |
| `value` |**oneOf:** enum: `XY`, `XZ`, `YZ` **OR** enum: `Custom`| Type for a plane. | No |
| `origin` |`object`| Origin of the plane. | No |
| `xAxis` |`object`| What should the plane’s X axis be? | No |
| `yAxis` |`object`| What should the plane’s Y axis be? | No |
| `zAxis` |`object`| The z-axis (normal). | No |
| `__meta` |`[` `object` `]`|  | No |


----
A face.



**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `face`|  | No |
| `id` |`string`| The id of the face. | No |
| `value` |`string`| The tag of the face. | No |
| `xAxis` |`object`| What should the face’s X axis be? | No |
| `yAxis` |`object`| What should the face’s Y axis be? | No |
| `zAxis` |`object`| The z-axis (normal). | No |
| `solid` |`object`| The solid the face is on. | No |
| `__meta` |`[` `object` `]`|  | No |


----




----
A sketch is a collection of paths.



**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `id` |`string`| The id of the sketch (this will change when the engine&#x27;s reference to it changes. | No |
| `value` |`[` **oneOf:** `object` **OR** `object` **OR** `object` **OR** `object` **OR** `object` **OR** `object` **OR** `object` `]`| The paths in the sketch. | No |
| `on` |**oneOf:** `object` **OR** `object`| What the sketch is on (can be a plane or a face). | No |
| `start` |`object`| The starting path. | No |
| `tags` |`object`| Tag identifiers that have been declared in this sketch. | No |
| `__meta` |`[` `object` `]`| Metadata. | No |


----





