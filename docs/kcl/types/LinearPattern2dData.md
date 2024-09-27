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
| `axis` |`array`| The axis of the pattern. This is a 2D vector. | No |
| `distance` |`number` (`double`)| The distance between each repetition. This can also be referred to as spacing. | No |
| `repetitions` |`integer` (`uint32`)| The number of repetitions. Must be greater than 0. This excludes the original entity. For example, if &#x60;repetitions&#x60; is 1, the original entity will be copied once. | No |


