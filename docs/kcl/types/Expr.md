---
title: "Expr"
excerpt: "An expression can be evaluated to yield a single KCL value."
layout: manual
---

An expression can be evaluated to yield a single KCL value.




**This schema accepts any of the following:**

An expression can be evaluated to yield a single KCL value.

[`Literal`](/docs/kcl/types/Literal)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `Literal`|  | No |
| `value` |[`LiteralValue`](/docs/kcl/types/LiteralValue)| An expression can be evaluated to yield a single KCL value. | No |
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
| `value` |[`LiteralValue`](/docs/kcl/types/LiteralValue)| An expression can be evaluated to yield a single KCL value. | No |
| `raw` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

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
An expression can be evaluated to yield a single KCL value.

[`TagDeclarator`](/docs/kcl/types#tag-declaration)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`TagDeclarator`](/docs/kcl/types#tag-declaration)|  | No |
| `value` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`TagDeclarator`](/docs/kcl/types#tag-declaration)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `value` |`string`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`BinaryExpression`](/docs/kcl/types/BinaryExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `BinaryExpression`|  | No |
| `operator` |[`BinaryOperator`](/docs/kcl/types/BinaryOperator)| An expression can be evaluated to yield a single KCL value. | No |
| `left` |[`BinaryPart`](/docs/kcl/types/BinaryPart)| An expression can be evaluated to yield a single KCL value. | No |
| `right` |[`BinaryPart`](/docs/kcl/types/BinaryPart)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `BinaryExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `operator` |[`BinaryOperator`](/docs/kcl/types/BinaryOperator)| An expression can be evaluated to yield a single KCL value. | No |
| `left` |[`BinaryPart`](/docs/kcl/types/BinaryPart)| An expression can be evaluated to yield a single KCL value. | No |
| `right` |[`BinaryPart`](/docs/kcl/types/BinaryPart)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`FunctionExpression`](/docs/kcl/types/FunctionExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`FunctionExpression`](/docs/kcl/types/FunctionExpression)|  | No |
| `params` |`[` [`Parameter`](/docs/kcl/types/Parameter) `]`|  | No |
| `body` |[`Program`](/docs/kcl/types/Program)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`FunctionExpression`](/docs/kcl/types/FunctionExpression)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `params` |`[` [`Parameter`](/docs/kcl/types/Parameter) `]`|  | No |
| `body` |[`Program`](/docs/kcl/types/Program)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`CallExpression`](/docs/kcl/types/CallExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `CallExpression`|  | No |
| `callee` |[`Identifier`](/docs/kcl/types/Identifier)| An expression can be evaluated to yield a single KCL value. | No |
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
| `callee` |[`Identifier`](/docs/kcl/types/Identifier)| An expression can be evaluated to yield a single KCL value. | No |
| `arguments` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `optional` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`PipeExpression`](/docs/kcl/types/PipeExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `PipeExpression`|  | No |
| `body` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `nonCodeMeta` |[`NonCodeMeta`](/docs/kcl/types/NonCodeMeta)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `PipeExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `body` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `nonCodeMeta` |[`NonCodeMeta`](/docs/kcl/types/NonCodeMeta)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`PipeSubstitution`](/docs/kcl/types/PipeSubstitution)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `PipeSubstitution`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `PipeSubstitution`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`ArrayExpression`](/docs/kcl/types/ArrayExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ArrayExpression`|  | No |
| `elements` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `nonCodeMeta` |[`NonCodeMeta`](/docs/kcl/types/NonCodeMeta)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ArrayExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `elements` |`[` [`Expr`](/docs/kcl/types/Expr) `]`|  | No |
| `nonCodeMeta` |[`NonCodeMeta`](/docs/kcl/types/NonCodeMeta)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`ArrayRangeExpression`](/docs/kcl/types/ArrayRangeExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ArrayRangeExpression`|  | No |
| `startElement` |[`Expr`](/docs/kcl/types/Expr)| An expression can be evaluated to yield a single KCL value. | No |
| `endElement` |[`Expr`](/docs/kcl/types/Expr)| An expression can be evaluated to yield a single KCL value. | No |
| `endInclusive` |`boolean`| Is the `end_element` included in the range? | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ArrayRangeExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `startElement` |[`Expr`](/docs/kcl/types/Expr)| An expression can be evaluated to yield a single KCL value. | No |
| `endElement` |[`Expr`](/docs/kcl/types/Expr)| An expression can be evaluated to yield a single KCL value. | No |
| `endInclusive` |`boolean`| Is the `end_element` included in the range? | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`ObjectExpression`](/docs/kcl/types/ObjectExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ObjectExpression`|  | No |
| `properties` |`[` [`ObjectProperty`](/docs/kcl/types/ObjectProperty) `]`|  | No |
| `nonCodeMeta` |[`NonCodeMeta`](/docs/kcl/types/NonCodeMeta)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `ObjectExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `properties` |`[` [`ObjectProperty`](/docs/kcl/types/ObjectProperty) `]`|  | No |
| `nonCodeMeta` |[`NonCodeMeta`](/docs/kcl/types/NonCodeMeta)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`MemberExpression`](/docs/kcl/types/MemberExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `MemberExpression`|  | No |
| `object` |[`MemberObject`](/docs/kcl/types/MemberObject)| An expression can be evaluated to yield a single KCL value. | No |
| `property` |[`LiteralIdentifier`](/docs/kcl/types/LiteralIdentifier)| An expression can be evaluated to yield a single KCL value. | No |
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
| `object` |[`MemberObject`](/docs/kcl/types/MemberObject)| An expression can be evaluated to yield a single KCL value. | No |
| `property` |[`LiteralIdentifier`](/docs/kcl/types/LiteralIdentifier)| An expression can be evaluated to yield a single KCL value. | No |
| `computed` |`boolean`|  | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`UnaryExpression`](/docs/kcl/types/UnaryExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `UnaryExpression`|  | No |
| `operator` |[`UnaryOperator`](/docs/kcl/types/UnaryOperator)| An expression can be evaluated to yield a single KCL value. | No |
| `argument` |[`BinaryPart`](/docs/kcl/types/BinaryPart)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `UnaryExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `operator` |[`UnaryOperator`](/docs/kcl/types/UnaryOperator)| An expression can be evaluated to yield a single KCL value. | No |
| `argument` |[`BinaryPart`](/docs/kcl/types/BinaryPart)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`IfExpression`](/docs/kcl/types/IfExpression)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `IfExpression`|  | No |
| `cond` |[`Expr`](/docs/kcl/types/Expr)| An expression can be evaluated to yield a single KCL value. | No |
| `then_val` |[`Program`](/docs/kcl/types/Program)| An expression can be evaluated to yield a single KCL value. | No |
| `else_ifs` |`[` [`ElseIf`](/docs/kcl/types/ElseIf) `]`|  | No |
| `final_else` |[`Program`](/docs/kcl/types/Program)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `IfExpression`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `cond` |[`Expr`](/docs/kcl/types/Expr)| An expression can be evaluated to yield a single KCL value. | No |
| `then_val` |[`Program`](/docs/kcl/types/Program)| An expression can be evaluated to yield a single KCL value. | No |
| `else_ifs` |`[` [`ElseIf`](/docs/kcl/types/ElseIf) `]`|  | No |
| `final_else` |[`Program`](/docs/kcl/types/Program)| An expression can be evaluated to yield a single KCL value. | No |
| `digest` |`[, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`, `integer`]`|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----
An expression can be evaluated to yield a single KCL value.

[`KclNone`](/docs/kcl/types/KclNone)






<<<<<<< HEAD
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `None`|  | No |
| `start` |`integer`|  | No |
| `end` |`integer`|  | No |
||||||| parent of 611085fe1 (Remove duplicate JSON "type" tags)
| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `None`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
=======
>>>>>>> 611085fe1 (Remove duplicate JSON "type" tags)


----





