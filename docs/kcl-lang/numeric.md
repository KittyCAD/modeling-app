---
title: "Numeric types and units"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

Numbers and numeric types in KCL include information about the units of the numbers. So rather than just having a number like `42`, we always have information about the units so we don't confuse 42 mm with 42 inches.


## Numeric literals

When writing a number literal, you can use a unit suffix to explicitly state the unit, e.g., `42mm`. The following units are available:

- Length units:
  - metric: `mm`, `cm`, `m`
  - imperial: `in`, `ft`, `yd`
- Angle units: `deg`, `rad`
- `_` to indicate a unitless number such as a count or ratio.

If you write a numeric literal without a suffix, then the defaults for the current file are used. These defaults are specified using the `@settings` attribute, see [settings](/docs/kcl-lang/settings) for details. Note that if using the defaults, the KCL interpreter won't know whether you intend the number to be a length, angle, or count and will treat it as being possibly any of them.


## Numeric types

Just like numbers carry units information, the `number` type also includes units information. Units are written in parentheses after the type, e.g., `number(mm)`.

Any of the suffixes described above can be used meaning that values with that type have the supplied units. E.g., `number(mm)` is the type of number values with mm units and `number(_)` is the type of number values with no units.

You can also use `number(Length)`, `number(Angle)`, or `number(Count)`. These types mean a number with any length, angle, or unitless (count) units, respectively (note that `number(_)` and `number(Count)` are equivalent since there is only one kind of unitless-ness).


## Function calls

When calling a function with an argument with numeric type, the declared numeric type in the function signature and the units of the argument value used in the function call must be compatible. Units are adjusted automatically. For example, if a function requires an argument with type `number(mm)`, then you can call it with `2in` and the units will be automatically adjusted, but calling it with `90deg` will cause an error.


## Mixing units with arithmetic

When doing arithmetic or comparisons, units will be adjusted as necessary if possible. However, often arithmetic expressions exceed the ability of KCL to accurately choose units which can result in warnings in your code or sometimes errors. In these cases, you will need to give KCL more information. Sometimes this can be done by making units explicit using suffixes. If not, then you will need to use *type ascription*, which asserts that an expression has the supplied type. For example, `(x * y): number(mm)` tells KCL that the units of `x * y` is mm. Note that type ascription does not do any adjustment of the numbers, e.g., `2mm: number(in)` has the value `2in` (note that this would be a very non-idiomatic way to use numeric type ascription, you could simply write `2in`. Usually type ascription is only necessary for supplying type information about the result of computation).

KCL has no support for area, volume, or other higher dimension units. When internal unit tracking requires multiple dimensions, KCL essentially gives up. This is usually where the extra type information described above is needed. If doing computation with higher dimensioned units, you must ensure that all adjustments occur before any computation. E.g., if you want to compute an area with unknown units, you must convert all numbers to the same unit before starting.


## Explicit conversions

You might sometimes need to convert from one unit to another for some calculation. You can do this implicitly when calling a function (see above), but if you can't or don't want to, then you can use the explicit conversion functions in the [`std::units`](/docs/kcl-std/modules/std-units) module.
