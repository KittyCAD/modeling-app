---
title: "Axis2d"
subtitle: "Type in std::types"
excerpt: "An abstract and infinite line in 2d space."
layout: manual
---

An abstract and infinite line in 2d space.

The `X`, `Y`, and `Z` axes are defined in the standard library. You can define custom axes by using an object with origin and direction properties.

The 2D version of the X axis could be defined like:

```js
xAxis2d = {
  origin = [0, 0],
  direction = [1, 0],
}
```

The number components of the origin and direction must be usable as lengths.

A 3D axis can be used in contexts that require a 2D axis. The Z component is ignored.



