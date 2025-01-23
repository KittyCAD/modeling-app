---
title: "PI"
excerpt: "The value of `pi`, Archimedes’ constant (π)."
layout: manual
---

The value of `pi`, Archimedes’ constant (π).



```js
PI: number = 3.14159265358979323846264338327950288_
```

### Examples

```js
circumference = 70

exampleSketch = startSketchOn("XZ")
 |> circle({ center = [0, 0], radius = circumference/ (2 * PI) }, %)

example = extrude(5, exampleSketch)
```

![Rendered example of PI 0](data:image/png;base64,)


