---
title: "string::trimEnd"
subtitle: "Function in std::string"
excerpt: "Remove whitespace from the end of a string."
layout: manual
---

Remove whitespace from the end of a string.

```kcl
string::trimEnd(@text: string): string
```

Whitespace is defined by Unicode's `White_Space` property and includes
spaces, tabs, newlines, and non-breaking spaces. Only the contiguous
whitespace at the end is removed; whitespace at the start or inside the
string is preserved.

The end is the end of the string's character sequence, independent of how
the text is displayed. If the input is empty or contains only whitespace,
this returns an empty string. Unicode normalization and case conversion are
not performed.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `text` | [`string`](/docs/kcl-std/types/std-types-string) | The string to trim. | Yes |

### Returns

[`string`](/docs/kcl-std/types/std-types-string) - A sequence of characters


### Examples

```kcl
result = "  KCL strings  "
  |> string::trimEnd()

assertIs(result == "  KCL strings")

```




