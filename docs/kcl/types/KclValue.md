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
| `value` |[`string`](/docs/kcl/types/string)|  | No |
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
| `value` |[`number`](/docs/kcl/types/number)|  | No |
| `ty` |[`NumericType`](/docs/kcl/types/NumericType)|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `String`|  | No |
| `value` |[`string`](/docs/kcl/types/string)|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `MixedArray`|  | No |
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
| `value` |[`string`](/docs/kcl/types/string)|  | No |
| `info` |[`TagEngineInfo`](/docs/kcl/types/TagEngineInfo)|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`TagDeclarator`](/docs/kcl/types#tag-declaration)|  | No |
| `value` |[`string`](/docs/kcl/types/string)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Plane`](/docs/kcl/types/Plane)|  | No |
| `value` |[`Plane`](/docs/kcl/types/Plane)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Face`](/docs/kcl/types/Face)|  | No |
| `value` |[`Face`](/docs/kcl/types/Face)| A face. | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Sketch`](/docs/kcl/types/Sketch)|  | No |
| `value` |[`Sketch`](/docs/kcl/types/Sketch)|  | No |


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
| `value` |[`Solid`](/docs/kcl/types/Solid)|  | No |


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
| `value` |[`Helix`](/docs/kcl/types/Helix)| A helix. | No |


----
Data for an imported geometry.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`ImportedGeometry`](/docs/kcl/types/ImportedGeometry)|  | No |
| `id` |[`string`](/docs/kcl/types/string)| The ID of the imported geometry. | No |
| `value` |`[` [`string`](/docs/kcl/types/string) `]`| The original file paths. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Function`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Module`|  | No |
| `value` |[`ModuleId`](/docs/kcl/types/ModuleId)| Identifier of a source file.  Uses a u32 to keep the size small. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Type`|  | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`KclNone`](/docs/kcl/types/KclNone)|  | No |
| `value` |[`KclNone`](/docs/kcl/types/KclNone)| KCL value for an optional parameter which was not given an argument. (remember, parameters are in the function declaration, arguments are in the function call/application). | No |
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




