---
title: "solver::equalRadius"
subtitle: "Function in std::solver"
excerpt: "Constrain circular segments to have equal radius."
layout: manual
---

Constrain circular segments to have equal radius.

```kcl
solver::equalRadius(@input: [Segment; 2+])
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | `[Segment; 2+]` | Two or more arc or circle segments that should share the same radius. | Yes |



