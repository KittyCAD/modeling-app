---
title: "EdgeCut"
excerpt: "A fillet or a chamfer."
layout: manual
---

A fillet or a chamfer.





**This schema accepts exactly one of the following:**

A fillet.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `fillet`|  | No |
| `id` |`string`| The id of the engine command that called this fillet. | No |
| `radius` |`number`|  | No |
| `edgeId` |`string`| The engine id of the edge to fillet. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)|  | No |


----
A chamfer.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `chamfer`|  | No |
| `id` |`string`| The id of the engine command that called this chamfer. | No |
| `length` |`number`|  | No |
| `edgeId` |`string`| The engine id of the edge to chamfer. | No |
| `tag` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)|  | No |


----




