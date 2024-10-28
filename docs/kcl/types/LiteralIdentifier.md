---
title: "LiteralIdentifier"
excerpt: ""
layout: manual
---






**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `name` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Literal`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `value` |[`LiteralValue`](/docs/kcl/types/LiteralValue)|  | No |
| `raw` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |


----




