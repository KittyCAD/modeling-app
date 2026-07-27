---
title: "string::toString"
subtitle: "Function in std::string"
excerpt: "Convert a number to text that reads like KCL source."
layout: manual
---

Convert a number to text that reads like KCL source.

```kcl
string::toString(@num: number): string
```

The result is compact: a unitless value has no suffix, a count keeps its
`_` suffix, and a value with concrete units keeps its canonical KCL
suffix. For example, `12`, `3_`, `12mm`, and `90deg`.

When the units are unclear, only the numeric component is returned. This
covers values whose units the type system cannot track, such as the result
of `2mm * 10mm`, which converts to `"20"`.

The numeric text is the shortest form that reads back as exactly the same
number. Values are never rounded, and there is no precision parameter.

Negative zero is the one exception. Both `-0` and `0` convert to `"0"`, so
the sign is not preserved. Agrees with KCL's other number-to-source
conversions that normalize the sign in the same way.

Non-finite numbers have no KCL representation, so they cannot be converted.
An infinity or a NaN, such as the result of `1 / 0`, stops evaluation with
an error rather than producing text that KCL could not parse.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `num` | [`number`](/docs/kcl-std/types/std-types-number) | The number to convert. | Yes |

### Returns

[`string`](/docs/kcl-std/types/std-types-string) - A sequence of characters


### Examples

```kcl
lengthText = 12mm
  |> string::toString()

assertIs(lengthText == "12mm")

countText = string::toString(3_)

assertIs(countText == "3_")

```




