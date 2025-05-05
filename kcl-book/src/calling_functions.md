# Calling functions

<!-- toc -->

In the last chapter, we looked at different data types that KCL can store. Now let's look at how to actually use them for more complex calculations. We use KCL functions for nearly everything, including all our mechanical engineering tools, so they're very important.

## Data in, data out

Let's look at a really simple function call.

```kcl
smallest = min([1, 2, 3, 0, 4])
```

This is a variable declaration, just like the variables we declared in the previous chapter. But the right-hand side -- the value the variable is defined as -- looks different. This is a _function call_. The function's name is `min`, as in "minimum".

Functions have _inputs_ and _outputs_. This function has just one input, an array of numbers. When you _call_ a function, you pass it inputs in between the parentheses/round brackets. Then KCL calculates its output. You can check its output by looking up `smallest` in the Variables panel. Spoiler: it's 0. Which is, as you'd expect, the minimum value in that array.

If you hover your mouse cursor over the function name `min`, you'll find some helpful documentation about the function. You can also look up all the possible functions at <https://docs.zoo.dev>. That page shows every function, and if you click it, you can see the function's name, inputs, outputs and some helpful examples of how to use it.

All functions take some data inputs and return an output. The inputs can be variables, just like you used in the previous chapter:

```kcl
myNumbers = [1, 2, 3, 0, 4]
smallest = min(myNumbers)
```

A function's inputs are also called its _arguments_. A function's output is also called its _return value_.

Here are some other simple functions you can call:

```kcl
absoluteValue = abs(-3)
roundedUp = ceil(12.5)
shouldBe2 = log10(100)
```

## Labeled arguments

The `min` function takes just one argument: an array of numbers. But most KCL functions take in multiple arguments. When there's many different arguments, it can be confusing to tell which argument means what. For example, what does this function do?

```kcl
x = pow(4, 2)
```

If you mouse over the docs for `pow` (or look them up at the KCL website) you'll see it's short for `power`, as in raising a number to some power (like squaring it, or cubing it). But, does `pow(4, 2)` mean 4 to the power of 2, or 2 to the power of 4? You could look up the docs, but that gets annoying quickly. Instead, KCL uses _labels_ for the parameters. The real `pow` call looks like this:

```kcl
x = pow(4, exp = 2)
```

Now you can tell that 2 is the _exponent_ (i.e. the power), not the base. If a KCL function has multiple arguments, only the first argument can be unlabeled. All the following arguments need a label. Here are some other examples.

```kcl
oldArray = [1, 2, 3]
newArray = push(oldArray, item = 4)
```

Here, we make a new array by pushing a new item onto the end of the old array. The old array is the first argument, so it doesn't need a label. The second argument, `item`, does need a label.

## Combining functions

Functions take inputs and produce an output. The real power of functions is: that output can become the input to another function! For example:

```kcl
x = 2
xSquared = pow(x, exp = 2)
xPow4 = pow(xSquared, exp = 2)
```

That's a very simple example, but it shows that you can assign the output of a function call to a variable (like `xSquared`) and then use it as the input to another function. Here's a more realistic example, where we use several functions to calculate the roots x0 and x1 of a quadratic equation.

```kcl
a = 2
b = 3
c = 1

delta = pow(b, exp = 2) - (4 * a * c)
x0 = ((-b) + sqrt(delta)) / (2 * a)
x1 = ((-b) - sqrt(delta)) / (2 * a)
```

If you open up the Variables panel, you'll see this gives two roots -0.5 and -1. Combining functions like this lets you break complicated equations into several small, simple steps. Each step can have its own variable, with a sensible name that explains how it's being used.

## Comments

This is a good point to introduce comments. When you start writing more complex code, with lots of function calls and variables, it might be hard for your colleagues (or your future self) to understand what you're trying to do. That's why KCL lets you leave comments to anyone reading your code. Let's add some comments to the quadratic equation code above:

```kcl
// Coefficients that define the quadratic
a = 2
b = 3
c = 1

// The quadratic equation's discriminant
delta = pow(b, exp = 2) - (4 * a * c)

// The two roots of the equation
x0 = ((-b) + sqrt(delta)) / (2 * a)
x1 = ((-b) - sqrt(delta)) / (2 * a)
```

If you type `//`, any subsequent text on that line is a comment. It doesn't get executed like the rest of the code! It's just for other humans to read.

## The standard library

KCL comes built-in with functions for all sorts of common engineering problems -- functions to calculate equations, sketch 2D shapes, combine and manipulate 3D shapes, etc. The built-in KCL functions are called the _standard library_, because it's like a big library of code you can always use.

You can create your own functions too, but we'll save that for a future chapter. You can get pretty far just using the built-in KCL functions! We're nearly ready to do some actual CAD work, but we've got to learn one more essential KCL feature first.

