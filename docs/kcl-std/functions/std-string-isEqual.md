---
title: "string::isEqual"
subtitle: "Function in std::string"
excerpt: "Compare two strings for equality."
layout: manual
---

Compare two strings for equality.

```kcl
string::isEqual(
  @text: string,
  to: string,
  caseInsensitive?: bool,
): bool
```

By default, this performs an exact, case-sensitive comparison equivalent
to the `==` operator. Set `caseInsensitive` to `true` to compare using
locale-independent full Unicode case folding.

Full case folding may expand characters; for example, `Straße` and
`STRASSE` compare as equal. The exact mappings follow the Unicode data
bundled with KCL.

Unicode normalization is not performed. Canonically equivalent strings
with different representations therefore compare as unequal. Empty strings
are valid inputs, and comparison is symmetric.

This function always returns a Boolean predicate, including inside a sketch
block. It does not create an equivalence constraint.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `text` | [`string`](/docs/kcl-std/types/std-types-string) | The string to compare. | Yes |
| `to` | [`string`](/docs/kcl-std/types/std-types-string) | The string to compare `text` with. | Yes |
| `caseInsensitive` | [`bool`](/docs/kcl-std/types/std-types-bool) | Whether to compare using locale-independent full Unicode case folding. | No |

### Returns

[`bool`](/docs/kcl-std/types/std-types-bool) - A boolean value.


### Examples

```kcl
matches = "Straße"
  |> string::isEqual(to = "STRASSE", caseInsensitive = true)

assertIs(matches)

```




