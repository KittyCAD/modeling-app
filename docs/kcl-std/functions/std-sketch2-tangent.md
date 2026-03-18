---
title: "sketch2::tangent"
subtitle: "Function in std::sketch2"
excerpt: "Constrain two segments to be tangent."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Constrain two segments to be tangent.

```kcl
sketch2::tangent(@input: [Segment; 2])
```

Supported input type pairs (unordered):
- `Line` / `Circle`
- `Line` / `CircularArc`
- `Circle` / `Circle`
- `Circle` / `CircularArc`
- `CircularArc` / `CircularArc`

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `input` | [[`Segment`](/docs/kcl-std/types/std-types-Segment); 2] |  | Yes |



