---
title: "number"
subtitle: "Type in std::types"
excerpt: "A number."
layout: manual
---

A number.

May be signed or unsigned, an integer or decimal value.

KCL numbers always include units, e.g., the number `42` is always '42 mm' or '42 degrees', etc.
it is never just '42'. The [`number`](/docs/kcl-std/types/std-types-number) type may or may not include units, if none are specified, then
it is the type of any number. E.g.,

- [`number`](/docs/kcl-std/types/std-types-number): the type of any numbers,
- [`number(mm)`](/docs/kcl-std/types/std-types-number): the type of numbers in millimeters,
- [`number(in)`](/docs/kcl-std/types/std-types-number): the type of numbers in inches,
- [`number(Length)`](/docs/kcl-std/types/std-types-number): the type of numbers in any length unit,
- [`number(deg)`](/docs/kcl-std/types/std-types-number): the type of numbers in degrees,
- [`number(Angle)`](/docs/kcl-std/types/std-types-number): the type of numbers in any angle unit,
- [`number(_)`](/docs/kcl-std/types/std-types-number) or [`number(Count)`](/docs/kcl-std/types/std-types-number): the type of unit-less numbers, representing a count of things,
or a ratio, etc.

For more information, see [numeric types](/docs/kcl-lang/numeric).



