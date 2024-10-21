---
title: "Expr"
excerpt: "An expression can be evaluated to yield a single KCL value."
layout: manual
---

An expression can be evaluated to yield a single KCL value.





**This schema accepts exactly one of the following:**


**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Literal`](/docs/kcl/types/Literal)|  | No |
| `kind` |[`Literal`](/docs/kcl/types/Literal)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`Identifier`](/docs/kcl/types/Identifier)|  | No |
| `kind` |[`Identifier`](/docs/kcl/types/Identifier)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`TagDeclarator`](/docs/kcl/types#tag-declaration)|  | No |
| `kind` |[`TagDeclarator`](/docs/kcl/types#tag-declaration)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`BinaryExpression`](/docs/kcl/types/BinaryExpression)|  | No |
| `kind` |[`BinaryExpression`](/docs/kcl/types/BinaryExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`FunctionExpression`](/docs/kcl/types/FunctionExpression)|  | No |
| `kind` |[`FunctionExpression`](/docs/kcl/types/FunctionExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`CallExpression`](/docs/kcl/types/CallExpression)|  | No |
| `kind` |[`CallExpression`](/docs/kcl/types/CallExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`PipeExpression`](/docs/kcl/types/PipeExpression)|  | No |
| `kind` |[`PipeExpression`](/docs/kcl/types/PipeExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`PipeSubstitution`](/docs/kcl/types/PipeSubstitution)|  | No |
| `kind` |[`PipeSubstitution`](/docs/kcl/types/PipeSubstitution)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`ArrayExpression`](/docs/kcl/types/ArrayExpression)|  | No |
| `kind` |[`ArrayExpression`](/docs/kcl/types/ArrayExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`ArrayRangeExpression`](/docs/kcl/types/ArrayRangeExpression)|  | No |
| `kind` |[`ArrayRangeExpression`](/docs/kcl/types/ArrayRangeExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`ObjectExpression`](/docs/kcl/types/ObjectExpression)|  | No |
| `kind` |[`ObjectExpression`](/docs/kcl/types/ObjectExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`MemberExpression`](/docs/kcl/types/MemberExpression)|  | No |
| `kind` |[`MemberExpression`](/docs/kcl/types/MemberExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`UnaryExpression`](/docs/kcl/types/UnaryExpression)|  | No |
| `kind` |[`UnaryExpression`](/docs/kcl/types/UnaryExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`IfExpression`](/docs/kcl/types/IfExpression)|  | No |
| `kind` |[`IfExpression`](/docs/kcl/types/IfExpression)| An expression can be evaluated to yield a single KCL value. | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----
KCL value for an optional parameter which was not given an argument. (remember, parameters are in the function declaration, arguments are in the function call/application).

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `None`|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----




