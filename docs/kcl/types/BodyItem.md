---
title: "BodyItem"
excerpt: ""
layout: manual
---





**This schema accepts any of the following:**


[`ImportStatement`](/docs/kcl/types/ImportStatement)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ImportStatement`|  | No |
| `items` |`[` [`ImportItem`](/docs/kcl/types/ImportItem) `]`|  | No |
| `path` |`string`|  | No |
| `raw_path` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ImportStatement`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `items` |`[` [`ImportItem`](/docs/kcl/types/ImportItem) `]`|  | No |
| `path` |`string`|  | No |
| `raw_path` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`ExpressionStatement`](/docs/kcl/types/ExpressionStatement)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ExpressionStatement`|  | No |
| `expression` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ExpressionStatement`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `expression` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`VariableDeclaration`](/docs/kcl/types/VariableDeclaration)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `VariableDeclaration`|  | No |
| `declarations` |`[` [`VariableDeclarator`](/docs/kcl/types/VariableDeclarator) `]`|  | No |
| `visibility` |[`ItemVisibility`](/docs/kcl/types/ItemVisibility)|  | No |
| `kind` |[`VariableKind`](/docs/kcl/types/VariableKind)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `VariableDeclaration`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `declarations` |`[` [`VariableDeclarator`](/docs/kcl/types/VariableDeclarator) `]`|  | No |
| `visibility` |[`ItemVisibility`](/docs/kcl/types/ItemVisibility)|  | No |
| `kind` |[`VariableKind`](/docs/kcl/types/VariableKind)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`ReturnStatement`](/docs/kcl/types/ReturnStatement)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ReturnStatement`|  | No |
| `argument` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ReturnStatement`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `argument` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----





