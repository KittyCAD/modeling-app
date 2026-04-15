---
title: "appearance::hexString"
subtitle: "Function in std::appearance"
excerpt: "Build a color from its red, green and blue components. These must be between 0 and 255."
layout: manual
---

Build a color from its red, green and blue components. These must be between 0 and 255.

```kcl
appearance::hexString(@rgb: [number(_); 3]): string
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `rgb` | [[`number(_)`](/docs/kcl-std/types/std-types-number); 3] | The red, blue and green components of the color. Must be between 0 and 255. | Yes |

### Returns

[`string`](/docs/kcl-std/types/std-types-string) - A sequence of characters



