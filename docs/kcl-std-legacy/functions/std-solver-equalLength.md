---
title: "solver::equalLength"
subtitle: "Function in std::solver"
excerpt: "Constrain lines to have equal length."
layout: manual
---

Constrain lines to have equal length.

```kcl
solver::equalLength(@lines: [Segment; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `lines` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2+] | Two or more line segments that should all share the same length. | Yes |



