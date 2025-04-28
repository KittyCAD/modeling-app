---
title: "KCL Types"
excerpt: "Documentation of types for the KCL standard library for the Zoo Design Studio."
layout: manual
---

`KCL` defines the following types and keywords the language.

All these types can be nested in various forms where nesting applies. Like
arrays can hold objects and vice versa.

## Boolean

`true` or `false` work when defining values.

## Constant declaration

Constants are defined with a name and a value, like so:

```
myBool = false
```

Currently you cannot redeclare a constant.

## Array

An array is defined with `[]` braces. What is inside the brackets can
be of any type. For example, the following is completely valid:

```
myArray = ["thing", 2, false]
```

If you want to get a value from an array you can use the index like so:
`myArray[0]`.


## Object

An object is defined with `{}` braces. Here is an example object:

```
myObj = { a = 0, b = "thing" }
```

We support two different ways of getting properties from objects, you can call
`myObj.a` or `myObj["a"]` both work.

## Binary expressions

You can also do math! Let's show an example below:

```
myMathExpression = 3 + 1 * 2 / 3 - 7
```

You can nest expressions in parenthesis as well:

```
myMathExpression = 3 + (1 * 2 / (3 - 7))
```

## Functions

We also have support for defining your own functions. Functions can take in any
type of argument. Below is an example of the syntax:

```
fn myFn(x) {
  return x
}
```

As you can see above `myFn` just returns whatever it is given.

KCL's early drafts used positional arguments, but we now use keyword arguments:

```
// If you declare a function like this
fn add(left, right) {
  return left + right
}

// You can call it like this:
total = add(left = 1, right = 2)
```

Functions can also declare one *unlabeled* arg. If you do want to declare an unlabeled arg, it must
be the first arg declared.

```
// The @ indicates an argument can be used without a label.
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

## Pipelines

It can be hard to read repeated function calls, because of all the nested brackets.

```norun
i = 1
x = h(g(f(i)))
```

You can make this easier to read by breaking it into many declarations, but that is a bit annoying.

```norun
i  = 1
x0 = f(i)
x1 = g(x0)
x  = h(x1)
```

Instead, you can use the pipeline operator (`|>`) to simplify this.

Basically, `x |> f(%)` is a shorthand for `f(x)`. The left-hand side of the `|>` gets put into
the `%` in the right-hand side.

So, this means `x |> f(%) |> g(%)` is shorthand for `g(f(x))`. The code example above, with its
somewhat-clunky `x0` and `x1` constants could be rewritten as

```norun
i = 1
x = i
  |> f(%)
  |> g(%)
  |> h(%)
```

This helps keep your code neat and avoid unnecessary declarations.

## Pipelines and keyword arguments

Say you have a long pipeline of sketch functions, like this:

```norun
startSketchOn(XZ)
  |> line(%, end = [3, 4])
  |> line(%, end = [10, 10])
  |> line(%, end = [-13, -14])
  |> close(%)
```

In this example, each function call outputs a sketch, and it gets put into the next function call via
the `%`, into the first (unlabeled) argument.

If a function call uses an unlabeled first parameter, it will default to `%` if it's not given. This
means that `|> line(%, end = [3, 4])` and `|> line(end = [3, 4])` are equivalent! So the above
could be rewritten as 

```norun
startSketchOn(XZ)
 |> line(end = [3, 4])
 |> line(end = [10, 10])
 |> line(end = [-13, -14])
 |> close()
```

Note that we are still in the process of migrating KCL's standard library to use keyword arguments. So some
functions are still unfortunately using positional arguments. We're moving them over, so keep checking back.
Some functions are still using the old positional argument syntax.
Check the docs page for each function and look at its examples to see.

## Tags

Tags are used to give a name (tag) to a specific path.

### Tag Declaration

The syntax for declaring a tag is `$myTag` you would use it in the following
way:

```norun
startSketchOn(XZ)
  |> startProfile(at = origin)
  |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
  |> angledLine(
       angle = segAng(rectangleSegmentA001) - 90,
       length = 196.99,
       tag = $rectangleSegmentB001,
     )
  |> angledLine(
       angle = segAng(rectangleSegmentA001),
       length = -segLen(rectangleSegmentA001),
       tag = $rectangleSegmentC001,
     )
  |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
  |> close()
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

```norun
fn rect(origin) {
  return startSketchOn(XZ)
    |> startProfile(at = origin)
    |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
    |> angledLine(
         angle = segAng(rectangleSegmentA001) - 90,
         length = 196.99,
         tag = $rectangleSegmentB001,
       )
    |> angledLine(
         angle = segAng(rectangleSegmentA001),
         length = -segLen(rectangleSegmentA001),
         tag = $rectangleSegmentC001,
       )
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
}

rect([0, 0])
rect([20, 0])
``` 

Those tags would only be available in the `rect` function and not globally.

However you likely want to use those tags somewhere outside the `rect` function.

Tags are accessible through the sketch group they are declared in.
For example the following code works.

```norun
fn rect(origin) {
  return startSketchOn(XZ)
    |> startProfile(at = origin)
    |> angledLine(angle = 0, length = 191.26, tag = $rectangleSegmentA001)
    |> angledLine(
         angle = segAng(rectangleSegmentA001) - 90,
         length = 196.99,
         tag = $rectangleSegmentB001,
       )
    |> angledLine(
         angle = segAng(rectangleSegmentA001),
         length = -segLen(rectangleSegmentA001),
         tag = $rectangleSegmentC001,
       )
    |> line(endAbsolute = [profileStartX(%), profileStartY(%)])
    |> close()
}

rect([0, 0])
myRect = rect([20, 0])

myRect
  |> extrude(length = 10)
  |> fillet(radius = 0.5, tags = [myRect.tags.rectangleSegmentA001])
```

See how we use the tag `rectangleSegmentA001` in the `fillet` function outside
the `rect` function. This is because the `rect` function is returning the
sketch group that contains the tags.


---

If you find any issues using any of the above expressions or syntax,
please file an issue with the `ast` label on the [modeling-app
repo](https://github.com/KittyCAD/modeling-app/issues/new).
