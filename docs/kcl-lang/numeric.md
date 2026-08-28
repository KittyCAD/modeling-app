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
As a shorthand, you can also just write the units of suffix as a type, e.g., `mm`.

Any of the suffixes described above can be used meaning that values with that type have the supplied units. E.g., `number(mm)` or `mm` is the type of number values with mm units and `number(_)` is the type of number values with no units.

You can also use `number(Length)`, `number(Angle)`, or `number(Count)`. These types mean a number with any length, angle, or unitless (count) units, respectively (note that `number(_)` and `number(Count)` are equivalent since there is only one kind of unitless-ness).

Using just `number` means accepting any kind of number, even where the units are unknown by KCL.


## Function calls

When calling a function with an argument with numeric type, the declared numeric type in the function signature and the units of the argument value used in the function call must be compatible. Units are adjusted automatically. For example, if a function requires an argument with type `number(mm)`, then you can call it with `2in` and the units will be automatically adjusted, but calling it with `90deg` will cause an error.


## Mixing units with arithmetic

When doing arithmetic or comparisons, units are adjusted as necessary. Multiplication adds physical-dimension exponents and division subtracts them. For example, `2cm * 3mm` produces an area equal to `0.6cm^2`, and dividing that result by `2mm` produces the length `3cm`. Equal dimensions divided by one another produce a unitless number. Integer powers apply their exponent to the input dimension, and roots work when every resulting dimension exponent is an integer, so `sqrt(3mm * 3mm + 4mm * 4mm)` produces `5mm`.

Area, volume, inverse-length, and other compound units are currently inferred values; KCL does not yet have literal suffixes or source-level type names for them. They can participate in further arithmetic and cancel back to a source-visible type such as `number(Length)` or `number(Count)`. Passing a compound value directly where an incompatible type is required remains an error. For example, `2mm * 3mm` is an area and cannot be passed to a function requiring a length.

Arithmetic over generic, explicitly erased, or otherwise unknown units can still exceed what KCL can prove. In those cases, make the input units concrete before doing the computation. Type ascription asserts a result type but does not adjust its numeric value; it cannot safely turn a known area into a length. For example, `2mm: in` has the value `2in` (this is non-idiomatic; simply write `2in`).


## Explicit conversions

You might sometimes need to convert from one unit to another for some calculation. You can do this implicitly when calling a function (see above), but if you can't or don't want to, then you can use the explicit conversion functions in the [`std::units`](/docs/kcl-std/modules/std-units) module.

Multiplying by a unitless scale does not change a value's units. For example, `10in * 25.4` is `254in`, not `254mm`. To convert a value, rely on automatic argument conversion or use the explicit conversion functions.

Converting between degrees and radians using π ([`PI`](/docs/kcl-std/consts/std-math-PI) in KCL) is especially prone to this error and so the `PI` constant always requires specifying units of any computation it is used with. E.g., `radius = (circumference / (2 * PI)): mm`.
