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

## Variable declaration

Variables are defined with the `let` keyword like so:

```
let myBool = false
```

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

## Tag Declaration and Tag Identifiers

The syntax for tags is now `$myTag` to declare a tag and `myTag` to then use it later. 

Please if you find any issues using any of the above expressions or syntax
please file an issue with the `ast` label on the [modeling-app
repo](https://github.com/KittyCAD/modeling-app/issues/new).
