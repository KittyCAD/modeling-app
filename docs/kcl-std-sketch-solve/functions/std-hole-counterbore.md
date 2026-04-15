---
title: "hole::counterbore"
subtitle: "Function in std::hole"
excerpt: "Cut a straight vertical counterbore at the top of the hole. Typically used when a fastener (e.g. the head cap on a screw) needs to sit flush with the solid's surface."
layout: manual
---

Cut a straight vertical counterbore at the top of the hole. Typically used when a fastener (e.g. the head cap on a screw) needs to sit flush with the solid's surface.

```kcl
hole::counterbore(
  diameter: number(Length),
  depth: number(Length),
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `diameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `depth` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |



