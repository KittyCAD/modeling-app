---
title: "Enums"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

An Enumeration (enum) is a named set of fixed choices. Use one where a value can only
be one of a few known things — a fit, a side, a finish. The alternative is a wider
type that accepts far more than those few choices: a string, where a misspelling is
accepted silently, or a number, whose meaning depends on context and has to be
remembered.

Enums are experimental, so every example here opts in with
`@settings(experimentalFeatures = allow)` at the top of the file.

## Declaring an enum

```kcl
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }
```

This snippet defines a *new* type called `Fit`. A value of that type can only be one
of the three *variants* (choices) listed between the braces.

Every variant begins with `|`, including the first one. An enum must be declared at
the top level of a file, not inside a function or a block.

The `|` is what marks the braces as a list of variants, so an enum with no variants
keeps `|` on its own:

```kcl
@settings(experimentalFeatures = allow)

type Nothing { | }
```

That is a valid enum, though it might look odd and is of limited use. With no
variants there is no value to write, so nothing can ever have the type `Nothing`.
[Asking for a variant](#using-a-variant) of it fails, whatever name you ask for:

```kcl,norun
@settings(experimentalFeatures = allow)

type Nothing { | }

// Error:
//   `None` is not a variant of enum `Nothing`. Enum `Nothing` has no variants.
nothing = Nothing::None
```

> **Note** – a type with no values is called an
> [empty type](https://en.wikipedia.org/wiki/Empty_type), and it does have uses in
> programming languages.

Leaving the marker out is not an empty enum but a mistake, and KCL says so:
`type Nothing { }` reports
`` An enum without variants still needs its arm marker; write it as `{ | }` ``.

Four more rules follow from a declaration naming an enum type. First, the name is a type
and not a value, so it cannot be used on its own:

```kcl,norun
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

// Error:
//   `Fit` is a type, not a value. Use one of its variants, such as `Fit::Loose`.
chosen = Fit
```

Second, a name can only be declared once in a file, whatever variants follow it:

```kcl,norun
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

// Error:
//   Redefinition of type Fit.
type Fit { | Tight | Free }
```

Third, a declaration belongs at the top level, so it cannot sit inside a function or
a block:

```kcl,norun
@settings(experimentalFeatures = allow)

fn pick() {
  // Error:
  //   Enum declarations are only supported at the top-level of a file.
  //   Move `type Fit` to the top-level.
  type Fit { | Loose | Press }
  return Fit::Loose
}

chosen = pick()
```

Fourth, the variants of one enum must have different names:

```kcl,norun
@settings(experimentalFeatures = allow)

// Error:
//   Duplicate variant `Loose` in enum `Fit`.
type Fit { | Loose | Normal | Loose }
```

## Using a variant

Once an enum is declared, its variants can be used like any other KCL value, such as
a string or a number. Write the enum name, then `::`, then the variant:

```kcl
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

holeFit = Fit::Press
```

In this code snippet, the variable `holeFit` now holds the value `Fit::Press`.

The name after `::` must be one of the variants in the declaration. Anything else
fails, and the error lists the variants that do exist:

```kcl,norun
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

// Error:
//   `Slack` is not a variant of enum `Fit`. Its variants are: Loose, Normal, Press.
holeFit = Fit::Slack
```

A variant is a value like any other. You can pass one to a function, return one, put
one in an array, and store one in an object. A variant is only a name: it carries no
further data, and there is no way to match on it beyond comparing it.

For example, this function works out the clearance between a hole and a shaft, then
returns the fit it implies:

```kcl
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

fn fitFor(hole: number(mm), shaft: number(mm)): Fit {
  clearance = hole - shaft
  return if clearance > 0.05mm {
    Fit::Loose
  } else if clearance > 0mm {
    Fit::Normal
  } else {
    Fit::Press
  }
}

dowelFit = fitFor(hole = 10.1mm, shaft = 10mm)
pinFit = fitFor(hole = 10mm, shaft = 10.02mm)
```

`dowelFit` has the value `Fit::Loose` and `pinFit` has the value `Fit::Press`. The
numbers stay in the function; what comes out is one of three enum variants (names)
that the rest of the code can rely on.

## Comparing variants

Comparison is how you act on a variant. There is no matching construct in KCL, so
`==` and `!=`, usually inside an `if`, do all the work:

```kcl
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

fit = Fit::Press
isPress = fit == Fit::Press
isLoose = fit == Fit::Loose
```

`isPress` is `true` and `isLoose` is `false`.

The difference from strings shows up when you mistype. A misspelled string still
compares, returning `false`, so the mistake goes unnoticed. A misspelled variant is an
error instead, and it names the variants that do exist.

Each declaration makes its own type. Two enums that happen to share a variant name
are still different types, and comparing values from different enums is an error
rather than `false`.

Both enums below declare a variant called `Loose`, and each compares fine against
itself:

```kcl
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }
type Tolerance { | Loose | Tight }

fitIsLoose = Fit::Loose == Fit::Loose
toleranceIsLoose = Tolerance::Loose == Tolerance::Loose
```

Comparing one against the other is an error — a shared variant name does not make two
enums the same type:

```kcl,norun
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }
type Tolerance { | Loose | Tight }

// Error:
//   Cannot compare enum `Fit` with enum `Tolerance`. They are different types.
bothLoose = Fit::Loose == Tolerance::Loose
```

Comparing a variant with a value of another kind is an error for the same reason. Each
comparison below fails on its own; evaluation stops at the first one:

```kcl,norun
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

// Error:
//   Cannot compare enum `Fit::Loose` with a string.
matchesText = Fit::Loose == "Loose"

// Error:
//   Cannot compare enum `Fit::Loose` with a number.
matchesNumber = Fit::Loose == 1
```

The not-equal operator `!=` behaves the same way: errors in the same cases, with the
same messages.

## Turning another value into a variant

KCL will not convert a string into a variant for you. Any such conversion has to
decide what to do with input that matches nothing, and only you can answer that, so
you write the conversion as a function.

Where the input is wrong, use `fail` to stop execution and provide a message of your
own. `fail` never returns a value, so it can sit in a branch of a function that
otherwise returns a variant:

```kcl
@settings(experimentalFeatures = allow)

type View { | Front | Top | Right | Isometric }

fn viewNamed(@name: string): View {
  return if name == "front" {
    View::Front
  } else if name == "top" {
    View::Top
  } else if name == "right" {
    View::Right
  } else if name == "iso" {
    View::Isometric
  } else {
    fail("view must be one of: front, top, right, iso")
  }
}

startView = viewNamed("iso")
```

`startView` is `View::Isometric`. The accepted strings need not match the variant
names — here `"iso"` gives `View::Isometric` — which is the point of writing the
mapping yourself.

When no if-branch matches, `fail`

1. stops evaluation
1. reports its message immediately
1. never returns a value, so the call produces nothing

For example, in the code below `startView` is never assigned and execution stops at
that point:

```kcl,norun
@settings(experimentalFeatures = allow)

type View { | Front | Top | Right | Isometric }

fn viewNamed(@name: string): View {
  return if name == "front" {
    View::Front
  } else {
    fail("view must be one of: front, top, right, iso")
  }
}

// Error:
//   view must be one of: front, top, right, iso
startView = viewNamed("side")
```

## Turning a variant into another value

A function can map the other way too, from an enum to another type. Consider the case
where the standard camera views are an enum, and the code that positions the camera
needs the angles those views stand for: an
[azimuth](https://en.wikipedia.org/wiki/Azimuth) around the vertical axis, and an
elevation above the horizon. The function below maps one to the other:

```kcl
@settings(experimentalFeatures = allow)

type View { | Front | Top | Right | Isometric }

fn cameraAngles(@view: View): [number(deg); 2] {
  return if view == View::Front {
    [0deg, 0deg]
  } else if view == View::Top {
    [0deg, 90deg]
  } else if view == View::Right {
    [90deg, 0deg]
  } else {
    [45deg, 35.264deg]
  }
}

isoAngles = cameraAngles(View::Isometric)
azimuth = isoAngles[0]
elevation = isoAngles[1]
```

`azimuth` is `45deg` and `elevation` is `35.264deg`, the standard isometric
viewpoint: turning 45 degrees and looking down at that angle makes all three axes
appear the same length.

This function needs no `fail`. An enum has a fixed set of variants, so the `else`
covers the one remaining view — unlike `viewNamed` above, which had to answer for any
string a caller might pass.

## Getting the name as a string

It is often useful to get the text of a variant's name. Write `: string` after a
variant to convert it:

```kcl
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

label = Fit::Press: string
```

`label` is the string `"Press"` — the name exactly as it is written in the
declaration. A string is the only type a variant converts to. For a number, or any
other type, write your own function, as in
[Turning another value into a variant](#turning-another-value-into-a-variant).

## Using an enum as a type

An enum is a type, so a function can declare a parameter of that type. KCL then
accepts only variants of that enum as the argument at each call:

```kcl
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }

fn clearanceFor(@fit: Fit) {
  return if fit == Fit::Press { 0.0 } else { 0.2 }
}

gap = clearanceFor(Fit::Loose)
```

Every other argument is an error, and the message names both the type the parameter
wants and the value it was given. Each call below fails on its own; evaluation stops
at the first one:

```kcl,norun
@settings(experimentalFeatures = allow)

type Fit { | Loose | Normal | Press }
type Tolerance { | Loose | Tight }

fn clearanceFor(@fit: Fit) {
  return if fit == Fit::Press { 0.0 } else { 0.2 }
}

// Error:
//   The input argument of `clearanceFor` requires a value with type `Fit`,
//   but found a value with type `string`.
gapText = clearanceFor("Loose")

// Error:
//   The input argument of `clearanceFor` requires a value with type `Fit`,
//   but found a value with type `number`.
gapNumber = clearanceFor(3)

// Error:
//   The input argument of `clearanceFor` requires a value with type `Fit`,
//   but found a value of enum `Tolerance` (with type `Tolerance`).
gapOther = clearanceFor(Tolerance::Loose)
```

## Current limitations

This is everything enums do today:

- A variant is a name and carries no data of its own.
- Comparison with `==` and `!=`, together with `if`, is the only way to act on a
  variant. There is no matching construct.
- A variant converts to a string and to nothing else. Any other conversion, in either
  direction, is a function you write.
- An enum must be declared at the top level of a file.

Enums are experimental, which is why each of the examples above opts in with
`@settings(experimentalFeatures = allow)`. The feature is still being developed, so
watch the release notes: expect this page to grow as more of it lands.
