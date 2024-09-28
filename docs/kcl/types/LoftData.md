---
title: "LoftData"
excerpt: "Data for a loft."
layout: manual
---

Data for a loft.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `vDegree` |`integer`| Degree of the interpolation. Must be greater than zero. For example, use 2 for quadratic, or 3 for cubic interpolation in the V direction. This defaults to 2, if not specified. | No |
| `bezApproximateRational` |`boolean`| Attempt to approximate rational curves (such as arcs) using a bezier. This will remove banding around interpolations between arcs and non-arcs.  It may produce errors in other scenarios Over time, this field won&#x27;t be necessary. | No |
| `baseCurveIndex` |`integer`| This can be set to override the automatically determined topological base curve, which is usually the first section encountered. | No |
| `tolerance` |`number`| Tolerance for the loft operation. | No |


