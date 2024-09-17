---
title: "KCL Types"
excerpt: "Documentation of types for the KCL standard library for the Zoo Modeling App."
layout: manual
---

`KCL` defines the following types and keywords the language.

All these types can be nested in various forms where nesting applies. Like
arrays can hold objects and vice versa.

## Boolean

`true` or `false` work when defining values.

## Constant declaration

Constants are defined with the `let` keyword like so:

```
let myBool = false
```

Currently you cannot redeclare a constant.

## Array

An array is defined with `[]` braces. What is inside the brackets can
be of any type. For example, the following is completely valid:

```
let myArray = ["thing", 2, false]
```

If you want to get a value from an array you can use the index like so:
`myArray[0]`.


## Object

An object is defined with `{}` braces. Here is an example object:

```
let myObj = {a: 0, b: "thing"}
```

We support two different ways of getting properties from objects, you can call
`myObj.a` or `myObj["a"]` both work.


## Functions

We also have support for defining your own functions. Functions can take in any
type of argument. Below is an example of the syntax:

```
fn myFn = (x) => {
  return x
}
```

As you can see above `myFn` just returns whatever it is given.


## Binary expressions

You can also do math! Let's show an example below:

```
let myMathExpression = 3 + 1 * 2 / 3 - 7
```

You can nest expressions in parenthesis as well:

```
let myMathExpression = 3 + (1 * 2 / (3 - 7))
```

## Tags

Tags are used to give a name (tag) to a specific path.

### Tag Declaration

The syntax for declaring a tag is `$myTag` you would use it in the following
way:

```
startSketchOn('XZ')
  |> startProfileAt(origin, %)
  |> angledLine([0, 191.26], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001, %) - 90,
       196.99
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001, %),
       -segLen(rectangleSegmentA001, %)
     ], %, $rectangleSegmentC001)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
```

### Tag Identifier

As per the example above you can use the tag identifier to get a reference to the 
tagged object. The syntax for this is `myTag`.

In the example above we use the tag identifier to get the angle of the segment
`segAng(rectangleSegmentA001, %)`.


### Tag Scope

Tags are scoped globally if in the root context meaning in this example you can 
use the tag `rectangleSegmentA001` in any function or expression in the file.

However if the code was written like this:

```
fn rect = (origin) => {
  return startSketchOn('XZ')
  |> startProfileAt(origin, %)
  |> angledLine([0, 191.26], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001, %) - 90,
       196.99
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001, %),
       -segLen(rectangleSegmentA001, %)
     ], %, $rectangleSegmentC001)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
}

rect([0, 0])
rect([20, 0])
``` 

Those tags would only be available in the `rect` function and not globally.

However you likely want to use those tags somewhere outside the `rect` function.

Tags are accessible through the sketch group they are declared in.
For example the following code works.

```
fn rect = (origin) => {
  return startSketchOn('XZ')
  |> startProfileAt(origin, %)
  |> angledLine([0, 191.26], %, $rectangleSegmentA001)
  |> angledLine([
       segAng(rectangleSegmentA001, %) - 90,
       196.99
     ], %, $rectangleSegmentB001)
  |> angledLine([
       segAng(rectangleSegmentA001, %),
       -segLen(rectangleSegmentA001, %)
     ], %, $rectangleSegmentC001)
  |> lineTo([profileStartX(%), profileStartY(%)], %)
  |> close(%)
}

rect([0, 0])
const myRect = rect([20, 0])

myRect 
  |> extrude(10, %)
  |> fillet({radius: 0.5, tags: [myRect.tags.rectangleSegmentA001]}, %)
```

See how we use the tag `rectangleSegmentA001` in the `fillet` function outside
the `rect` function. This is because the `rect` function is returning the
sketch group that contains the tags.


---

If you find any issues using any of the above expressions or syntax,
please file an issue with the `ast` label on the [modeling-app
repo](https://github.com/KittyCAD/modeling-app/issues/new).
