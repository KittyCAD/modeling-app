---
title: "NonCodeValue"
excerpt: ""
layout: manual
---






**This schema accepts exactly one of the following:**

A shebang. This is a special type of comment that is at the top of the file. It looks like this: ```python,no_run #!/usr/bin/env python ```

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `shebang`|  | No |
| `value` |`string`|  | No |


----
An inline comment. Here are examples: `1 + 1 // This is an inline comment`. `1 + 1 /* Here's another */`.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `inlineComment`|  | No |
| `value` |`string`|  | No |
| `style` |[`CommentStyle`](/docs/kcl/types/CommentStyle)|  | No |


----
A block comment. An example of this is the following: ```python,no_run /* This is a block comment */ 1 + 1 ``` Now this is important. The block comment is attached to the next line. This is always the case. Also the block comment doesn't have a new line above it. If it did it would be a `NewLineBlockComment`.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `blockComment`|  | No |
| `value` |`string`|  | No |
| `style` |[`CommentStyle`](/docs/kcl/types/CommentStyle)|  | No |


----
A block comment that has a new line above it. The user explicitly added a new line above the block comment.

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `newLineBlockComment`|  | No |
| `value` |`string`|  | No |
| `style` |[`CommentStyle`](/docs/kcl/types/CommentStyle)|  | No |


----

**Type:** `object`





## Properties

| Property | Type | Description | Required |
|----------|------|-------------|----------|
| `type` |enum: `newLine`|  | No |


----




