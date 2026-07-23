---
title: "fail"
subtitle: "Function in std"
excerpt: "Stop KCL evaluation with a user-defined error."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Stop KCL evaluation with a user-defined error.

```kcl
fail(@msg: string): never
```

Use `fail` when evaluation cannot continue and the caller should receive a
specific error message. `fail` never returns a value.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `msg` | [`string`](/docs/kcl-std/types/std-types-string) | Message reported to the caller. | Yes |

### Returns

[`never`](/docs/kcl-std/types/std-types-never) - The uninhabited type of computations that never complete normally.


### Examples

```kcl
fn positive(@value: number): number {
  return if value > 0 {
    value
  } else {
    fail("value must be positive")
  }
}

```




