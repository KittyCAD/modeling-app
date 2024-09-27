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
| `arcDegrees` |`number` (`double`)| The arc angle (in degrees) to place the repetitions. Must be greater than 0. | No |
| `axis` |`array`| The axis around which to make the pattern. This is a 3D vector. | No |
| `center` |`array`| The center about which to make the pattern. This is a 3D vector. | No |
| `repetitions` |`integer` (`uint32`)| The number of repetitions. Must be greater than 0. This excludes the original entity. For example, if &#x60;repetitions&#x60; is 1, the original entity will be copied once. | No |
| `rotateDuplicates` |`boolean`| Whether or not to rotate the duplicates as they are copied. | No |


