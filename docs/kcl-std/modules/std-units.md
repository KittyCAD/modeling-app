---
title: "units"
subtitle: "Module in std"
excerpt: "Functions for converting numbers to different units. "
layout: manual
---

Functions for converting numbers to different units. 

All numbers in KCL include units, e.g., the number `42` is always '42 mm' or '42 degrees', etc. it is never just '42'. For more information, see [numeric types](/docs/kcl-lang/numeric). 

Note that you only need to explicitly convert the units of a number if you need a specific unit for your own calculations. When calling a function, KCL will convert a number to the required units automatically (where possible, and give an error or warning if it's not possible). 


## Functions and constants

* [`units::toCentimeters`](/docs/kcl-std/functions/std-units-toCentimeters)
* [`units::toDegrees`](/docs/kcl-std/functions/std-units-toDegrees)
* [`units::toFeet`](/docs/kcl-std/functions/std-units-toFeet)
* [`units::toInches`](/docs/kcl-std/functions/std-units-toInches)
* [`units::toMeters`](/docs/kcl-std/functions/std-units-toMeters)
* [`units::toMillimeters`](/docs/kcl-std/functions/std-units-toMillimeters)
* [`units::toRadians`](/docs/kcl-std/functions/std-units-toRadians)
* [`units::toYards`](/docs/kcl-std/functions/std-units-toYards)

