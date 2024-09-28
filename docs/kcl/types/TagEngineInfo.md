---
title: "TagEngineInfo"
excerpt: "Engine information for a tag."
layout: manual
---

Engine information for a tag.

**Type:** `object`






## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `id` |`string`| The id of the tagged object. | No |
| `sketch` |`string`| The sketch the tag is on. | No |
| `path` |**anyOf:** [`BasePath`](/docs/kcl/types/BasePath) **OR** `null`| The path the tag is on. | No |
| `surface` |**anyOf:** [`ExtrudeSurface`](/docs/kcl/types/ExtrudeSurface) **OR** `null`| The surface information for the tag. | No |


