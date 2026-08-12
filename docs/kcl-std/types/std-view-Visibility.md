---
title: "view::Visibility"
subtitle: "Type in std::view"
excerpt: "Whether a named view shows or hides objects by default."
layout: manual
---

**WARNING:** This type is experimental and may change or be removed.

Whether a named view shows or hides objects by default.

```kcl
type Visibility {
  | Show
  | Hide
}
```




### Variants

| Variant | Description |
|---------|-------------|
| `Show` | Objects are shown unless the view hides them. |
| `Hide` | Objects are hidden unless the view shows them. |


