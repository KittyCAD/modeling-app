---
title: "SketchGroupSet"
excerpt: "A sketch group or a group of sketch groups."
layout: manual
---

A sketch group or a group of sketch groups.




**This schema accepts exactly one of the following:**

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
| `type` | enum: `sketchGroup`
 |  | No |
| `value` | `array`
 | The paths in the sketch group. | No |


----


**Type:** `[object, array]`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` | enum: `sketchGroups`
 |  | No |


----




