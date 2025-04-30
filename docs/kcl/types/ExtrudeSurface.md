---
title: "ExtrudeSurface"
excerpt: "An extrude surface."
layout: manual
---

An extrude surface.





**This schema accepts exactly one of the following:**

An extrude plane.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `extrudePlane`|  | No |
| `faceId` |[`string`](/docs/kcl/types/string)| The face id for the extrude plane. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag. | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the geometry. | No |
| `sourceRange` |`[, `integer`, `integer`, `integer`]`| The source range. | No |


----
An extruded arc.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `extrudeArc`|  | No |
| `faceId` |[`string`](/docs/kcl/types/string)| The face id for the extrude plane. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag. | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the geometry. | No |
| `sourceRange` |`[, `integer`, `integer`, `integer`]`| The source range. | No |


----
Geometry metadata.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `chamfer`|  | No |
| `faceId` |[`string`](/docs/kcl/types/string)| The id for the chamfer surface. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag. | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the geometry. | No |
| `sourceRange` |`[, `integer`, `integer`, `integer`]`| The source range. | No |


----
Geometry metadata.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `fillet`|  | No |
| `faceId` |[`string`](/docs/kcl/types/string)| The id for the fillet surface. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| The tag. | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the geometry. | No |
| `sourceRange` |`[, `integer`, `integer`, `integer`]`| The source range. | No |


----




