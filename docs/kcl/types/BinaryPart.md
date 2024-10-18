---
title: "BinaryPart"
excerpt: ""
layout: manual
---





**This schema accepts any of the following:**


[`Literal`](/docs/kcl/types/Literal)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Literal`|  | No |
| `value` |[`LiteralValue`](/docs/kcl/types/LiteralValue)|  | No |
| `raw` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Literal`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `value` |[`LiteralValue`](/docs/kcl/types/LiteralValue)|  | No |
| `raw` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`Identifier`](/docs/kcl/types/Identifier)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `name` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `name` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`BinaryExpression`](/docs/kcl/types/BinaryExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `BinaryExpression`|  | No |
| `operator` |[`BinaryOperator`](/docs/kcl/types/BinaryOperator)|  | No |
| `left` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `right` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `BinaryExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `operator` |[`BinaryOperator`](/docs/kcl/types/BinaryOperator)|  | No |
| `left` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `right` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`CallExpression`](/docs/kcl/types/CallExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `CallExpression`|  | No |
| `callee` |[`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `arguments` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `optional` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `CallExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `callee` |[`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `arguments` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `optional` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`UnaryExpression`](/docs/kcl/types/UnaryExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `UnaryExpression`|  | No |
| `operator` |[`UnaryOperator`](/docs/kcl/types/UnaryOperator)|  | No |
| `argument` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `UnaryExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `operator` |[`UnaryOperator`](/docs/kcl/types/UnaryOperator)|  | No |
| `argument` |[`BinaryPart`](/docs/kcl/types/BinaryPart)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`MemberExpression`](/docs/kcl/types/MemberExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `MemberExpression`|  | No |
| `object` |[`MemberObject`](/docs/kcl/types/MemberObject)|  | No |
| `property` |[`LiteralIdentifier`](/docs/kcl/types/LiteralIdentifier)|  | No |
| `computed` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `MemberExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `object` |[`MemberObject`](/docs/kcl/types/MemberObject)|  | No |
| `property` |[`LiteralIdentifier`](/docs/kcl/types/LiteralIdentifier)|  | No |
| `computed` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----

[`IfExpression`](/docs/kcl/types/IfExpression)






<<<<<<< HEAD
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
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `IfExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `cond` |[`Expr`](/docs/kcl/types/Expr)|  | No |
| `then_val` |[`Program`](/docs/kcl/types/Program)|  | No |
| `else_ifs` |`[` [`ElseIf`](/docs/kcl/types/ElseIf) `]`|  | No |
| `final_else` |[`Program`](/docs/kcl/types/Program)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----





