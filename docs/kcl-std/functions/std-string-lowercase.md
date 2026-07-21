---
title: "string::lowercase"
subtitle: "Function in std::string"
excerpt: "Convert all cased characters in a string to lowercase."
layout: manual
---

Convert all cased characters in a string to lowercase.

```kcl
string::lowercase(@text: string): string
```

This conversion is Unicode-aware and locale-independent. Some conversions
depend on the surrounding characters; for example, a Greek capital sigma
becomes `ς` at the end of a word and `σ` elsewhere. Some characters expand
into multiple characters; for example, `İ` becomes `i` followed by a
combining dot above. The exact mappings follow the Unicode data bundled
with KCL.

Unicode normalization is not performed. Canonically equivalent strings
therefore retain their original representations. Empty strings and strings
without cased characters are returned unchanged.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `text` | [`string`](/docs/kcl-std/types/std-types-string) | The string to convert. | Yes |

### Returns

[`string`](/docs/kcl-std/types/std-types-string) - A sequence of characters


### Examples

```kcl
result = "KCL ΟΣ"
  |> string::lowercase()

assertIs(result == "kcl ος")

```




