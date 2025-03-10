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
| `angleStart` |[`number`](/docs/kcl/types/number) (**maximum:** 360.0) (**minimum:** -360.0)| The start angle. | No |
| `angleEnd` |[`number`](/docs/kcl/types/number) (**maximum:** 360.0) (**minimum:** -360.0)| The end angle. | No |
| `radius` |[`number`](/docs/kcl/types/number)| The radius. | No |


----
Center, to and radius with an optional tag.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `center` |`[number, number]`| The center. | No |
| `to` |`[number, number]`| The to point. | No |
| `radius` |[`number`](/docs/kcl/types/number)| The radius. | No |


----





