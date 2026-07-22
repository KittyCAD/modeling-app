---
title: "string::trimStart"
subtitle: "Function in std::string"
excerpt: "Remove whitespace from the start of a string."
layout: manual
---

Remove whitespace from the start of a string.

```kcl
string::trimStart(@text: string): string
```

Whitespace is defined by Unicode's `White_Space` property and includes
spaces, tabs, newlines, and non-breaking spaces. Only the contiguous
whitespace at the start is removed; whitespace inside or at the end of the
string is preserved.

The start is the beginning of the string's character sequence, independent
of how the text is displayed. If the input is empty or contains only
whitespace, this returns an empty string. Unicode normalization and case
conversion are not performed.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `text` | [`string`](/docs/kcl-std/types/std-types-string) | The string to trim. | Yes |

### Returns

[`string`](/docs/kcl-std/types/std-types-string) - A sequence of characters


### Examples

```kcl
result = "  KCL strings  "
  |> string::trimStart()

assertIs(result == "KCL strings  ")

```




