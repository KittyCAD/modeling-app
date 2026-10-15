---
title: "gdt::LeaderType"
subtitle: "Type in std::gdt"
excerpt: "The end marker on a leader attached to a face or edge."
layout: manual
---

**WARNING:** This type is experimental and may change or be removed.

The end marker on a leader attached to a face or edge.

```kcl
type LeaderType {
  | None
  | Dot
  | Arrow
}
```

Use, for example, `leaderType = gdt::LeaderType::Arrow` on `gdt::datum`,
geometric tolerance callouts, or `gdt::annotation`. The default is `Dot`.
Explicit enum choices require `@settings(experimentalFeatures = allow)`
in the calling file. Existing calls that omit `leaderType` do not need it.
This does not change the separate datum triangle or the arrows on
`gdt::distance`. Free-floating `gdt::note` annotations do not have leaders.


### Variants

| Variant | Description |
|---------|-------------|
| `None` | No end marker. The leader line remains visible. |
| `Dot` | A screen-space dot, normalized to stay the same size as `fontSize` changes. |
| `Arrow` | A model-space arrowhead whose size follows `fontSize` and `leaderScale`. |


