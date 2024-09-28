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
| `repetitions` |`integer` (`uint32`)| The number of repetitions. Must be greater than 0. This excludes the original entity. For example, if &#x60;repetitions&#x60; is 1, the original entity will be copied once. | No |
| `center` |`array`| The center about which to make the pattern. This is a 2D vector. | No |
| `arcDegrees` |`number` (`double`)| The arc angle (in degrees) to place the repetitions. Must be greater than 0. | No |
| `rotateDuplicates` |`boolean`| Whether or not to rotate the duplicates as they are copied. | No |


