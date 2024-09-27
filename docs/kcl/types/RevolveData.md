---
title: "RevolveData"
excerpt: "Data for revolution surfaces."
layout: manual
---

Data for revolution surfaces.


**Type:** `object`




## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `angle` |`number`| Angle to revolve (in degrees). Default is 360. | No |
| `axis` |**anyOf:** **oneOf:** enum: `X` **OR** enum: `Y` **OR** enum: `-X` **OR** enum: `-Y` **OR** `object` **OR** **anyOf:** `string` **OR** [`TagIdentifier`](/docs/kcl/types#tag-identifier)| Axis of revolution. | No |
| `tolerance` |`number`| Tolerance for the revolve operation. | No |


