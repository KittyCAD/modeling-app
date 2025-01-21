---
title: "HelixData"
excerpt: "Data for a helix."
layout: manual
---

Data for a helix.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `revolutions` |`number`| Number of revolutions. | No |
| `angleStart` |`number`| Start angle (in degrees). | No |
| `ccw` |`boolean`| Is the helix rotation counter clockwise? The default is `false`. | No |
| `length` |`number`| Length of the helix. This is not necessary if the helix is created around an edge. If not given the length of the edge is used. | No |
| `radius` |`number`| Radius of the helix. | No |
| `axis` |[`Axis3dOrEdgeReference`](/docs/kcl/types/Axis3dOrEdgeReference)| Axis to use as mirror. | No |


