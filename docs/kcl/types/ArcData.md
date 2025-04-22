---
title: "ArcData"
excerpt: "Data to draw an arc."
layout: manual
---

Data to draw an arc.




**This schema accepts any of the following:**

Angles and radius with an optional tag.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `angleStart` |`TyF64`| The start angle. | No |
| `angleEnd` |`TyF64`| The end angle. | No |
| `radius` |`TyF64`| The radius. | No |


----
Center, to and radius with an optional tag.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `center` |`[, `TyF64`, `TyF64`]`| The center. | No |
| `to` |`[, `TyF64`, `TyF64`]`| The to point. | No |
| `radius` |`TyF64`| The radius. | No |


----





