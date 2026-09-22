---
title: "solver::fixed"
subtitle: "Function in std::solver"
excerpt: "Constrain a point to be fixed to a position."
layout: manual
---

Constrain a point to be fixed to a position.

```kcl
solver::fixed(@points: [Segment | Point2d; 2+])
```

`fixed()` is an alias for `coincident()`. By convention, `fixed()` is used when one of the points is a known location, not solved with constraints and not another point in the sketch.

Calling `fixed()` with one segment, such as `fixed(edge)`, is invalid and produces an argument error. `fixed()` requires an array of at least two points or segments. To anchor a point to a fixed position, pass both values, for example `fixed([edge.start, ORIGIN])`.


See [coincident()](/docs/kcl-std/functions/std-solver-coincident) for more info.

### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `points` | [[`Segment`](/docs/kcl-std/types/std-types-Segment) or [`Point2d`](/docs/kcl-std/types/std-types-Point2d); 2+] | Two or more sketch entities that should be coincident. When more than two inputs are provided, each item must be a point or `ORIGIN`. | Yes |


### Examples

```kcl
profile = sketch(on = XY) {
  edge = line(start = [var 0mm, var 0mm], end = [var 10mm, var 0mm])
  fixed([edge.start, ORIGIN])
  horizontal(edge)
  horizontalDistance([edge.start, edge.end]) == 10mm
}

```


![Rendered example of solver::fixed 0](/kcl-test-outputs/serial_test_example_fn_std-solver-fixed0.png)


