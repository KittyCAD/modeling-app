---
title: "KclValue"
excerpt: "Any KCL value."
layout: manual
---

Any KCL value.





**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Uuid`|  | No |
| `value` |`string`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Bool`|  | No |
| `value` |`boolean`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Number`|  | No |
| `value` |`number`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Int`|  | No |
| `value` |`integer`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `String`|  | No |
| `value` |`string`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Array`|  | No |
| `value` |`[` [`KclValue`](/docs/kcl/types/KclValue) `]`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Object`|  | No |
| `value` |`object`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`TagIdentifier`](/docs/kcl/types#tag-identifier)|  | No |
| `value` |`string`|  | No |
| `info` |[`TagEngineInfo`](/docs/kcl/types/TagEngineInfo)|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`TagDeclarator`](/docs/kcl/types#tag-declaration)|  | No |
| `value` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Plane`](/docs/kcl/types/Plane)|  | No |
| `value` |[`Plane`](/docs/kcl/types/Plane)| Any KCL value. | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Face`](/docs/kcl/types/Face)|  | No |
| `value` |[`Face`](/docs/kcl/types/Face)| Any KCL value. | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Sketch`](/docs/kcl/types/Sketch)|  | No |
| `value` |[`Sketch`](/docs/kcl/types/Sketch)| Any KCL value. | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Sketches`|  | No |
| `value` |`[` [`Sketch`](/docs/kcl/types/Sketch) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Solid`](/docs/kcl/types/Solid)|  | No |
| `value` |[`Solid`](/docs/kcl/types/Solid)| Any KCL value. | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Solids`|  | No |
| `value` |`[` [`Solid`](/docs/kcl/types/Solid) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Helix`](/docs/kcl/types/Helix)|  | No |
| `value` |[`Helix`](/docs/kcl/types/Helix)| Any KCL value. | No |


----
Data for an imported geometry.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`ImportedGeometry`](/docs/kcl/types/ImportedGeometry)|  | No |
| `id` |`string`| The ID of the imported geometry. | No |
| `value` |`[` `string` `]`| The original file paths. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Function`|  | No |
| `memory` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)| Any KCL value. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Module`|  | No |
| `value` |[`ModuleId`](/docs/kcl/types/ModuleId)| Any KCL value. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`KclNone`](/docs/kcl/types/KclNone)|  | No |
| `value` |[`KclNone`](/docs/kcl/types/KclNone)| Any KCL value. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Tombstone`|  | No |
| `value` |`null`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----




