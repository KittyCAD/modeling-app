---
title: "BinaryPart"
excerpt: ""
layout: manual
---






**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Literal`|  | No |
| `value` |[`LiteralValue`](/docs/kcl/types/LiteralValue)|  | No |
| `raw` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `name` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `BinaryExpression`|  | No |
| `operator` |[`BinaryOperator`](/docs/kcl/types/BinaryOperator)|  | No |
| `left` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `right` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `CallExpression`|  | No |
| `callee` |[`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `arguments` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `optional` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `UnaryExpression`|  | No |
| `operator` |[`UnaryOperator`](/docs/kcl/types/UnaryOperator)|  | No |
| `argument` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `MemberExpression`|  | No |
| `object` |[`MemberObject`](/docs/kcl/types/MemberObject)|  | No |
| `property` |[`LiteralIdentifier`](/docs/kcl/types/LiteralIdentifier)|  | No |
| `computed` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `IfExpression`|  | No |
| `cond` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `then_val` |[`Program`](/docs/kcl/types/Program)|  | No |
| `else_ifs` |`[` [`ElseIf`](/docs/kcl/types/ElseIf) `]`|  | No |
| `final_else` |[`Program`](/docs/kcl/types/Program)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |


----




