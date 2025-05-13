---
title: "Arrays and ranges"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

Arrays are sequences of values.

Arrays can be written out as *array literals* using a sequence of expressions surrounded by square brackets, e.g., `['hello', 'world']` is an array of strings, `[x, x + 1, x + 2]` is an array of numbers (assuming `x` is a number), `[]` is an empty array, and `['hello', 42, true]` is a mixed array.

A value in an array can be accessed by indexing using square brackets where the index is a number, for example, `arr[0]`, `arr[42]`, `arr[i]` (where `arr` is an array and `i` is a (whole) number).

There are some useful functions for working with arrays in the standard library, see [std::array](/docs/kcl-std/modules/std-array) for details.

## Array types

Arrays have their own types: `[T]` where `T` is the type of the elements of the array, for example, `[string]` means an array of `string`s and `[any]` means an array of any values.

Array types can also include length information: `[T; n]` denotes an array of length `n` (where `n` is a number literal) and `[T; 1+]` denotes an array whose length is at least one (i.e., a non-empty array). E.g., `[string; 1+]` and `[number(mm); 3]` are valid array types.

## Ranges

Ranges are a succinct way to create an array of sequential numbers. The syntax is `[start .. end]` where `start` and `end` evaluate to whole numbers (integers). Ranges are inclusive of the start and end. The end must be greater than the start. Examples:

```kcl,norun
[0..3]      // [0, 1, 2, 3]
[3..10]     // [3, 4, 5, 6, 7, 8, 9, 10]
x = 2
[x..x+1]    // [2, 3]
```

The units of the start and end numbers must be the same and the result inherits those units. 
