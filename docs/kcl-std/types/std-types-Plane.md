---
title: "Plane"
subtitle: "Type in std::types"
excerpt: "An abstract plane."
layout: manual
---

An abstract plane.

A plane has a position and orientation in space defined by its origin and axes. A plane is abstract
in the sense that it is not part of the objects being drawn. A plane can be used to sketch on.

A plane can be created in several ways:
- you can use one of the default planes, e.g., `XY`.
- you can use `offsetPlane` to create a new plane offset from an existing one, e.g., `offsetPlane(XY, offset = 150)`.
- you can use negation to create a plane from an existing one which is identical but has an opposite normal
e.g., `-XY`.
- you can define an entirely custom plane, e.g.,

```js
myXY = {
  origin = { x = 0, y = 0, z = 0 },
  xAxis = { x = 1, y = 0, z = 0 },
  yAxis = { x = 0, y = 1, z = 0 },
}
```

Any object with appropriate `origin`, `xAxis`, and `yAxis` fields can be used as a plane.
The plane's Z axis (i.e. which way is "up") will be the cross product X x Y. In other words,
KCL planes follow the right-hand rule.



