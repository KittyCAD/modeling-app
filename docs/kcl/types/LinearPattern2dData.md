---
title: "LinearPattern2dData"
excerpt: "Data for a linear pattern on a 2D sketch."
layout: manual
---

Data for a linear pattern on a 2D sketch.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `instances` |[`Uint`](/docs/kcl/types/Uint)| The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | No |
| `distance` |`number`| The distance between each repetition. This can also be referred to as spacing. | No |
| `axis` |`[number, number]`| The axis of the pattern. This is a 2D vector. | No |


