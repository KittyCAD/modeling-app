---
title: "CircularPattern3dData"
excerpt: "Data for a circular pattern on a 3D model."
layout: manual
---

Data for a circular pattern on a 3D model.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `instances` |`integer`| The number of total instances. Must be greater than or equal to 1. This includes the original entity. For example, if instances is 2, there will be two copies -- the original, and one new copy. If instances is 1, this has no effect. | No |
| `axis` |`[number, number, number]`| The axis around which to make the pattern. This is a 3D vector. | No |
| `center` |`[number, number, number]`| The center about which to make the pattern. This is a 3D vector. | No |
| `arcDegrees` |`number`| The arc angle (in degrees) to place the repetitions. Must be greater than 0. | No |
| `rotateDuplicates` |`boolean`| Whether or not to rotate the duplicates as they are copied. | No |


