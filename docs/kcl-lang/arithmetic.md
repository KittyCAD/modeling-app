---
title: "Arithmetic and logic"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

KCL supports the usual arithmetic operators on numbers and logic operators on booleans:

| Operator | Meaning |
|----------|---------|
| `+` | Addition |
| `-` | Subtraction or unary negation |
| `*` | Multiplication |
| `/` | Division |
| `%` | Modulus aka remainder |
| `^` | Power, e.g., `x ^ 2` means `x` squared |
| `&` | Logical 'and' |
| `\|` | Logical 'or' |
| `!` | Unary logical 'not' |

KCL also supports comparsion operators which operate on numbers and produce booleans:

| Operator | Meaning |
|----------|---------|
| `==` | Equal |
| `!=` | Not equal |
| `<` | Less than |
| `>` | Greater than |
| `<=` | Less than or equal |
| `>=` | Greater than or equal |

Arithmetics and logic expressions can be arbitrairly combined with the usual rules of associativity and precedence, e.g.,

```
myMathExpression = 3 + 1 * 2 / 3 - 7
```

You can also nest expressions in parenthesis:

```
myMathExpression = 3 + (1 * 2 / (3 - 7))
```

KCL numbers are implemented using [floating point numbers](https://en.wikipedia.org/wiki/Floating-point_arithmetic). This means that there are occasionally representation and rounding issues, and some oddities such as supporting positive and negative zero.

Some operators can be applied to other types:

- `+` can be used to concatenate strings, e.g., `'hello' + ' ' + 'world!'`
- Unary `-` can be used with planes or line-like objects such as axes to produce an object with opposite orientation, e.g., `-XY` is a plain which is aligned with `XY` but whose normal aligns with the negative Z axis.
- The following operators can be used with solids as shorthand for CSG operations:
  - `+` or `|` for [`union`](/docs/kcl-std/union).
  - `-` for [`subtract`](/docs/kcl-std/subtract).
  - `&` for [`intersect`](/docs/kcl-std/intersect)
