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
| `axis` |`array`| The axis of the pattern. | No |
| `distance` |`number` (`double`)| The distance between each repetition. This can also be referred to as spacing. | No |
| `repetitions` |`integer` (`uint32`)| The number of repetitions. Must be greater than 0. This excludes the original entity. For example, if &#x60;repetitions&#x60; is 1, the original entity will be copied once. | No |


