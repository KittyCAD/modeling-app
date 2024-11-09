---
title: "BodyItem"
excerpt: ""
layout: manual
---






**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ImportStatement`|  | No |
| `items` |`[` [`ImportItem`](/docs/kcl/types/ImportItem) `]`|  | No |
| `path` |`string`|  | No |
| `raw_path` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ExpressionStatement`|  | No |
| `expression` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `VariableDeclaration`|  | No |
| `declarations` |`[` [`VariableDeclarator`](/docs/kcl/types/VariableDeclarator) `]`|  | No |
| `visibility` |[`ItemVisibility`](/docs/kcl/types/ItemVisibility)|  | No |
| `kind` |[`VariableKind`](/docs/kcl/types/VariableKind)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ReturnStatement`|  | No |
| `argument` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----




