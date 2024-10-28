---
title: "TagEngineInfo"
excerpt: "Engine information for a tag."
layout: manual
---

Engine information for a tag.

**Type:** `object`



**This schema accepts exactly one of the following:**

The path the tag is on.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `path` |[`Path`](/docs/kcl/types/Path)| Engine information for a tag. | No |


----
The surface information for the tag.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `surface` |[`ExtrudeSurface`](/docs/kcl/types/ExtrudeSurface)| Engine information for a tag. | No |


----


## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `id` |`string`| The id of the tagged object. | No |
| `sketch` |`string`| The sketch the tag is on. | No |


