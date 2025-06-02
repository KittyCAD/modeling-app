---
title: "assertIs"
subtitle: "Function in std"
excerpt: "Asserts that a value is the boolean value true."
layout: manual
---

Asserts that a value is the boolean value true.

```kcl
assertIs(
  @actual: bool,
  error?: string,
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `actual` | [`bool`](/docs/kcl-std/types/std-types-bool) | Value to check. If this is the boolean value true, assert passes. Otherwise it fails.. | Yes |
| `error` | [`string`](/docs/kcl-std/types/std-types-string) | If the value was false, the program will terminate with this error message | No |


### Examples

```kcl
kclIsFun = true
assertIs(kclIsFun)
```



