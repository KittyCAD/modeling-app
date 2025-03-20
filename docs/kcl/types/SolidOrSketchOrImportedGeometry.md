---
title: "SolidOrSketchOrImportedGeometry"
excerpt: "Data for a solid or an imported geometry."
layout: manual
---

Data for a solid or an imported geometry.





**This schema accepts exactly one of the following:**

Data for an imported geometry.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `importedGeometry`|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The ID of the imported geometry. | No |
| `value` |`[` [`string`](/docs/kcl/types/string) `]`| The original file paths. | No |


----

**Type:** `[object, array]`

`[` [`Solid`](/docs/kcl/types/Solid) `]`



## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `solidSet`|  | No |


----

**Type:** `[object, array]`

`[` [`Sketch`](/docs/kcl/types/Sketch) `]`



## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `sketchSet`|  | No |


----




