---
title: "CircularPattern2dData"
excerpt: "Data for a circular pattern on a 2D sketch."
layout: manual
---

Data for a circular pattern on a 2D sketch.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `instances` |[`Uint`](/docs/kcl/types/Uint)| The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | No |
| `center` |`[number, number]`| The center about which to make the pattern. This is a 2D vector. | No |
| `arcDegrees` |`number`| The arc angle (in degrees) to place the repetitions. Must be greater than 0. | No |
| `rotateDuplicates` |`boolean`| Whether or not to rotate the duplicates as they are copied. | No |


