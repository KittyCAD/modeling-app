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
| `type` |enum: [`ImportStatement`](/docs/kcl/types/ImportStatement)|  | No |
| `kind` |[`ImportStatement`](/docs/kcl/types/ImportStatement)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`ExpressionStatement`](/docs/kcl/types/ExpressionStatement)|  | No |
| `kind` |[`ExpressionStatement`](/docs/kcl/types/ExpressionStatement)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`VariableDeclaration`](/docs/kcl/types/VariableDeclaration)|  | No |
| `kind` |[`VariableDeclaration`](/docs/kcl/types/VariableDeclaration)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: [`ReturnStatement`](/docs/kcl/types/ReturnStatement)|  | No |
| `kind` |[`ReturnStatement`](/docs/kcl/types/ReturnStatement)|  | No |
| `start` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |
| `end` |[`EnvironmentRef`](/docs/kcl/types/EnvironmentRef)|  | No |


----




