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
| `path` |[`Sketch`](/docs/kcl/types/Sketch)| The path to sweep along. | No |
| `sectional` |`boolean`| If true, the sweep will be broken up into sub-sweeps (extrusions, revolves, sweeps) based on the trajectory path components. | No |
| `tolerance` |`number`| Tolerance for the sweep operation. | No |


