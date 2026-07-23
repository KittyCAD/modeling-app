---
title: "string::trim"
subtitle: "Function in std::string"
excerpt: "Remove whitespace from the start and end of a string."
layout: manual
---

Remove whitespace from the start and end of a string.

```kcl
string::trim(@text: string): string
```

Whitespace is defined by Unicode's `White_Space` property and includes
spaces, tabs, newlines, and non-breaking spaces. Whitespace inside the
string is preserved.

If the input is empty or contains only whitespace, this returns an empty
string. Unicode normalization and case conversion are not performed.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `text` | [`string`](/docs/kcl-std/types/std-types-string) | The string to trim. | Yes |

### Returns

[`string`](/docs/kcl-std/types/std-types-string) - A sequence of characters


### Examples

```kcl
result = "  KCL strings  "
  |> string::trim()

assertIs(result == "KCL strings")

```




