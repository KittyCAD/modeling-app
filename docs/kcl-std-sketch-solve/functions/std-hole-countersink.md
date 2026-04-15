---
title: "hole::countersink"
subtitle: "Function in std::hole"
excerpt: "Cut an angled countersink at the top of the hole. Typically used when a conical screw head has to sit flush with the surface being cut into."
layout: manual
---

Cut an angled countersink at the top of the hole. Typically used when a conical screw head has to sit flush with the surface being cut into.

```kcl
hole::countersink(
  diameter: number(Length),
  angle: number(Angle),
)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `diameter` | [`number(Length)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |
| `angle` | [`number(Angle)`](/docs/kcl-std/types/std-types-number) | A number. | Yes |



