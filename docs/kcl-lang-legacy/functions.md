---
title: "Functions"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

We have support for defining your own functions. Functions can take in any
type of argument. Below is an example of the syntax:

```
fn myFn(x) {
  return x
}
```

As you can see above `myFn` just returns whatever it is given.

KCL uses keyword arguments:

```
// If you declare a function like this
fn add(left, right) {
  return left + right
}

// You can call it like this:
total = add(left = 1, right = 2)
```

Functions can also declare one *unlabeled* arg. If you do want to declare an unlabeled arg, it must be the first arg and prefixed with @, like this:

```
// The @ indicates an argument is used without a label.
// Note that only the first argument can use @.
fn increment(@x) {
  return x + 1
}

fn add(@x, delta) {
  return x + delta
}

two = increment(1)
three = add(1, delta = 2)
```

Below shows how a custom function must be called if it has a labeled argument, and another example with an unlabeled argument:

```
@settings(defaultLengthUnit = mm)

// All args must be labeled when calling (no @ on first param)
fn cube1(offsetX, offsetY, radius, length) {
  return startSketchOn(XY)
    |> polygon(radius = radius, numSides = 4, center = [offsetX, offsetY])
    |> extrude(length = length)
}

// First arg may be unlabeled at call sites (because of @)
fn cube2(@offsetX, offsetY, radius, length) {
  return startSketchOn(XY)
    |> polygon(radius = radius, numSides = 4, center = [offsetX, offsetY])
    |> extrude(length = length)
}

// Function Calls
testCube1 = cube1(offsetX = 0, offsetY = 6, radius = 5, length = 5)  // all labeled
testCube2 = cube2(0,           offsetY = 10, radius = 5, length = 5)  // first unlabeled works here
```