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
| `__meta` |`array`| Metadata. | No |
| `id` |`string` (`uuid`)| The id of the sketch (this will change when the engine&#x27;s reference to it changes. | No |
| `on` |`oneOf`| What the sketch is on (can be a plane or a face). | No |
| `start` |`object`| The starting path. | No |
| `tags` |`object`| Tag identifiers that have been declared in this sketch. | No |
| `value` |`array`| The paths in the sketch. | No |


