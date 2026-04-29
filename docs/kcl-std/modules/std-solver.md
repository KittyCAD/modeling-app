---
title: "solver"
subtitle: "Module in std"
excerpt: "Functions for sketch-solve using constraints. This module's items are for use within sketch blocks. "
layout: manual
---

Functions for sketch-solve using constraints. This module's items are for use within sketch blocks. 

```kcl,inline,sketchSolve
triangle = sketch(on = XY) {
  line1 = line(start = [var -0.05mm, var -0.01mm], end = [var 3.88mm, var 0.81mm])
  line2 = line(start = [var 3.88mm, var 0.81mm], end = [var 0.92mm, var 4.67mm])
  coincident([line1.end, line2.start])
  line3 = line(start = [var 0.92mm, var 4.67mm], end = [var -0.03mm, var -0.04mm])
  coincident([line2.end, line3.start])
  coincident([line1.start, line3.end])
  horizontal(line1)
  equalLength([line2, line3])
}

triangleRegion = region(point = [0.5mm, 0.5mm], sketch = triangle)
extrude(triangleRegion, length = 5)
```

In the above example, the `sketch(on = XY) { ... }` is called the sketch
block. Inside the curly braces, all the functions and constants in this
module are in scope and available.

Values introduced with `var` are only initial guesses for the solver.
They are starting positions or starting sizes, not locked values, and the
solver is free to change them in the final solved sketch.

For that reason, initial guesses should always be literals. Do not use
identifiers, constant references, or computed expressions as initial
guesses. For example, use `var 0mm` or `var 10mm`, not `var width`,
`var baseRadius`, or `var (plateWidth / 2)`.

If a value must stay fixed, put that value in the constraint itself.
Constants and expressions belong in `distance`, `radius`, `diameter`,
`horizontalDistance`, `verticalDistance`, and similar constraint
functions, because those are what actually constrain the solved result.



## Functions and constants

* [`solver::ORIGIN`](/docs/kcl-std/consts/std-solver-ORIGIN)
* [`solver::angle`](/docs/kcl-std/functions/std-solver-angle)
* [`solver::arc`](/docs/kcl-std/functions/std-solver-arc)
* [`solver::circle`](/docs/kcl-std/functions/std-solver-circle)
* [`solver::coincident`](/docs/kcl-std/functions/std-solver-coincident)
* [`solver::diameter`](/docs/kcl-std/functions/std-solver-diameter)
* [`solver::distance`](/docs/kcl-std/functions/std-solver-distance)
* [`solver::equalLength`](/docs/kcl-std/functions/std-solver-equalLength)
* [`solver::equalRadius`](/docs/kcl-std/functions/std-solver-equalRadius)
* [`solver::fixed`](/docs/kcl-std/functions/std-solver-fixed)
* [`solver::horizontal`](/docs/kcl-std/functions/std-solver-horizontal)
* [`solver::horizontalDistance`](/docs/kcl-std/functions/std-solver-horizontalDistance)
* [`solver::line`](/docs/kcl-std/functions/std-solver-line)
* [`solver::midpoint`](/docs/kcl-std/functions/std-solver-midpoint)
* [`solver::parallel`](/docs/kcl-std/functions/std-solver-parallel)
* [`solver::perpendicular`](/docs/kcl-std/functions/std-solver-perpendicular)
* [`solver::point`](/docs/kcl-std/functions/std-solver-point)
* [`solver::radius`](/docs/kcl-std/functions/std-solver-radius)
* [`solver::symmetric`](/docs/kcl-std/functions/std-solver-symmetric)
* [`solver::tangent`](/docs/kcl-std/functions/std-solver-tangent)
* [`solver::vertical`](/docs/kcl-std/functions/std-solver-vertical)
* [`solver::verticalDistance`](/docs/kcl-std/functions/std-solver-verticalDistance)

