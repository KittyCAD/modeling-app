---
title: "Sketch"
excerpt: "A sketch is a collection of paths."
layout: manual
---

A sketch is a collection of paths.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `id` |`string`| The id of the sketch (this will change when the engine's reference to it changes). | No |
| `paths` |`[` [`Path`](/docs/kcl/types/Path) `]`| The paths in the sketch. | No |
| `on` |[`SketchSurface`](/docs/kcl/types/SketchSurface)| What the sketch is on (can be a plane or a face). | No |
| `start` |[`BasePath`](/docs/kcl/types/BasePath)| The starting path. | No |
| `tags` |`object`| Tag identifiers that have been declared in this sketch. | No |
| `artifactId` |[`ArtifactId`](/docs/kcl/types/ArtifactId)| The original id of the sketch. This stays the same even if the sketch is is sketched on face etc. | No |
| `units` |[`UnitLen`](/docs/kcl/types/UnitLen)| A sketch is a collection of paths. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`| Metadata. | No |


