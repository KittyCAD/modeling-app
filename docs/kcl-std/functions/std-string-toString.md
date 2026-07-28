---
title: "string::toString"
subtitle: "Function in std::string"
excerpt: "Convert a number to human-readable text."
layout: manual
---

Convert a number to human-readable text.

```kcl
string::toString(@num: number): string
```

Defined for every [`number`](/docs/kcl-std/types/std-types-number) value, including the non-finite ones.

| Value | Result | Why |
|---|---|---|
| `12` | `"12"` | no units, so no suffix |
| `1.5` | `"1.5"` | never rounded |
| `0.1 + 0.2` | `"0.30000000000000004"` | no digits are dropped |
| `-7` | `"-7"` | |
| `-0` | `"0"` | the sign of zero is not kept |
| `3_` | `"3_"` | a count keeps its `_` |
| `12mm` | `"12mm"` | a concrete length keeps its suffix |
| `12cm`, `12m`, `1.5in`, `2ft`, `3yd` | `"12cm"`, `"12m"`, `"1.5in"`, `"2ft"`, `"3yd"` | every length unit does |
| `90deg` | `"90deg"` | a concrete angle keeps its suffix |
| `1.5rad` | `"1.5rad"` | both angle units do |
| `2mm + 10mm` | `"12mm"` | arithmetic that keeps its units |
| `2mm * 10mm` | `"20"` | units no longer tracked, so none is shown |
| `1 / 0` | `"Infinity"` | |
| `-1 / 0` | `"-Infinity"` | |
| `0 / 0` | `"NaN"` | |
| `1mm / 0` | `"Infinity"` | a non-finite value never carries a unit |

The output is meant to be read, not parsed. Some results are not valid KCL
source and reading one back is not supported.

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




