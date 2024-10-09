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
| `type` |enum: `UserVal`|  | No |
| `value` |``|  | No |
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
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `value` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |


----
A plane.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Plane`|  | No |
| `id` |`string`| The id of the plane. | No |
| `value` |[`PlaneType`](/docs/kcl/types/PlaneType)| Any KCL value. | No |
| `origin` |[`Point3d`](/docs/kcl/types/Point3d)| Origin of the plane. | No |
| `xAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the plane’s X axis be? | No |
| `yAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the plane’s Y axis be? | No |
| `zAxis` |[`Point3d`](/docs/kcl/types/Point3d)| The z-axis (normal). | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----
A face.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Face`|  | No |
| `id` |`string`| The id of the face. | No |
| `value` |`string`| The tag of the face. | No |
| `xAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the face’s X axis be? | No |
| `yAxis` |[`Point3d`](/docs/kcl/types/Point3d)| What should the face’s Y axis be? | No |
| `zAxis` |[`Point3d`](/docs/kcl/types/Point3d)| The z-axis (normal). | No |
| `solid` |[`Solid`](/docs/kcl/types/Solid)| The solid the face is on. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----
An solid is a collection of extrude surfaces.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Solid`](/docs/kcl/types/Solid)|  | No |
| `id` |`string`| The id of the solid. | No |
| `value` |`[` [`ExtrudeSurface`](/docs/kcl/types/ExtrudeSurface) `]`| The extrude surfaces. | No |
| `sketch` |[`Sketch`](/docs/kcl/types/Sketch)| The sketch. | No |
| `height` |`number`| The height of the solid. | No |
| `startCapId` |`string`| The id of the extrusion start cap | No |
| `endCapId` |`string`| The id of the extrusion end cap | No |
| `edgeCuts` |`[` [`EdgeCut`](/docs/kcl/types/EdgeCut) `]`| Chamfers or fillets on this solid. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`| Metadata. | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Solids`|  | No |
| `value` |`[` [`Solid`](/docs/kcl/types/Solid) `]`|  | No |


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
| `expression` |[`FunctionExpression`](/docs/kcl/types/FunctionExpression)| Any KCL value. | No |
| `memory` |[`ProgramMemory`](/docs/kcl/types/ProgramMemory)| Any KCL value. | No |
| `__meta` |`[` [`Metadata`](/docs/kcl/types/Metadata) `]`|  | No |


----




