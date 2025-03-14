---
title: "SketchSet"
excerpt: "A sketch or a group of sketches."
layout: manual
---

A sketch or a group of sketches.





**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `sketch`|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The id of the sketch (this will change when the engine's reference to it changes). | No |
| `paths` |`[` [`Path`](/docs/kcl/types/Path) `]`| The paths in the sketch. | No |
| `on` |[`SketchSurface`](/docs/kcl/types/SketchSurface)| What the sketch is on (can be a plane or a face). | No |
| `start` |[`BasePath`](/docs/kcl/types/BasePath)| The starting path. | No |
| `tags` |`object`| Tag identifiers that have been declared in this sketch. | No |
| `artifactId` |[`ArtifactId`](/docs/kcl/types/ArtifactId)| The original id of the sketch. This stays the same even if the sketch is is sketched on face etc. | No |
| `originalId` |[`string`](/docs/kcl/types/string)|  | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A unit of length. | No |


----

**Type:** `[object, array]`

`[` [`Sketch`](/docs/kcl/types/Sketch) `]`



## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `sketches`|  | No |


----




