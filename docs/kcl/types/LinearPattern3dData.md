---
title: "LinearPattern3dData"
excerpt: "Data for a linear pattern on a 3D model."
layout: manual
---

Data for a linear pattern on a 3D model.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `repetitions` |[`Uint`](/docs/kcl/types/Uint)| The number of repetitions. Must be greater than 0. This excludes the original entity. For example, if `repetitions` is 1, the original entity will be copied once. | No |
| `distance` |`number`| The distance between each repetition. This can also be referred to as spacing. | No |
| `axis` |`[number, number, number]`| The axis of the pattern. | No |


