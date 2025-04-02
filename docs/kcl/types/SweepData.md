---
title: "SweepData"
excerpt: "Data for a sweep."
layout: manual
---

Data for a sweep.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `path` |[`SweepPath`](/docs/kcl/types/SweepPath)| The path to sweep along. | No |
| `sectional` |`boolean`| If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components. | No |
| `tolerance` |`number`| Tolerance for the sweep operation. | No |


