---
title: "SketchSurface"
excerpt: "A sketch type."
layout: manual
---

A sketch type.





**This schema accepts exactly one of the following:**

A plane.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `plane`|  | No |
| `id` |`string`| The id of the plane. | No |
| `artifactId` |[`ArtifactId`](/docs/kcl/types/ArtifactId)| The artifact ID. | No |
| `value` |[`PlaneType`](/docs/kcl/types/PlaneType)| A sketch type. | No |
| `origin` |[`Point3d`](/docs/kcl/types/Point3d)| Origin of the plane. | No |
| `xAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the plane’s X axis be? | No |
| `yAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the plane’s Y axis be? | No |
| `zAxis` |[`Point3d`](/docs/kcl/types/Point3d)| The z-axis (normal). | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A sketch type. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----
A face.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `face`|  | No |
| `id` |`string`| The id of the face. | No |
| `artifactId` |[`ArtifactId`](/docs/kcl/types/ArtifactId)| The artifact ID. | No |
| `value` |`string`| The tag of the face. | No |
| `xAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the face’s X axis be? | No |
| `yAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the face’s Y axis be? | No |
| `zAxis` |[`Point3d`](/docs/kcl/types/Point3d)| The z-axis (normal). | No |
| `solid` |[`Solid`](/docs/kcl/types/Solid)| The solid the face is on. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A sketch type. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----




