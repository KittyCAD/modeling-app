---
title: "view::Orientation"
subtitle: "Type in std::view"
excerpt: "A standard camera orientation for a named view."
layout: manual
---

**WARNING:** This type is experimental and may change or be removed.

A standard camera orientation for a named view.

```kcl
type Orientation {
  | Front
  | Back
  | Left
  | Right
  | Top
  | Bottom
  | Isometric
}
```

The six axis-aligned orientations name the side of the model the camera
looks at; `Isometric` is the standard three-quarter view.


### Variants

| Variant | Description |
|---------|-------------|
| `Front` | The camera looks at the front of the model. |
| `Back` | The camera looks at the back of the model. |
| `Left` | The camera looks at the left side of the model. |
| `Right` | The camera looks at the right side of the model. |
| `Top` | The camera looks down at the top of the model. |
| `Bottom` | The camera looks up at the bottom of the model. |
| `Isometric` | The standard three-quarter view, showing three faces of the model at once. |


