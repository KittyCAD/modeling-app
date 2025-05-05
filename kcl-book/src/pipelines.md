# Pipeline syntax
<!-- toc -->

In the previous chapter we learned how to call functions: you write the function's name, then give its inputs in parentheses, like this:

```kcl
x = pow(2, exp = 2)
```

What if you want to repeatedly call a function, then call another function on that output? Here's an example:

```kcl
sqrt(sqrt(sqrt(64)))
```

We find the square root of 64, then pass its output as the input to another square root call. And another. And another. Eventually we've found the eighth root of 64.

This is pretty hard to read! We could make it more readable by breaking it up into single calls and assigning each to its own variable, like this:

```kcl
x = 64
y = sqrt(x)
z = sqrt(y)
w = sqrt(z)
```

But then we have to think of meaningful names, and add a lot of variables. Now the Variables pane shows all these intermediate variables like `y` and `z`. Sometimes that's helpful, but sometimes it can be distracting.

Passing the output of a function into another function's input is a _very_ common task in KCL code. So, KCL has a nice little feature for simplifying this common pattern. It's called a _pipeline_. Let's rewrite the above using pipeline syntax:


```kcl
x = 64
w = sqrt(x)
  |> sqrt(%)
  |> sqrt(%)
```

What's going on here? Basically, if you call two functions like `g(f(x))` you could rewrite it as `f(x) |> g(%)`. Whatever is to the left of the `|>` gets calculated, then passed into the function on the right of `|>`. The `%` symbol basically means "use whatever was to the left of `|>`". The `|>` is basically a triangle pointing to the right, showing that the data on the left flows into the function on the right. You can think of it like an assembly line in a factory, moving parts (data) between different machines (functions) using a conveyor belt (the `|>` symbol).

Let's see another example. If you take a number's square root, and then square it again, it should give you the original number back. Let's test that.


```kcl
x = 64
xRoot = sqrt(x)
shouldBeX = pow(xRoot, exp = 2)
```

Let's rewrite this using pipelines:

```kcl
x = 64
shouldBeX = sqrt(x)
  |> pow(%, exp = 2)
```

## Implicit %

All those %s can be a bit annoying to read. Remember how some KCL functions declare a special unlabeled first argument? If a function uses the special unlabeled argument, then that argument will default to %. Basically, if you use these functions in a pipeline, you can omit the % and KCL will insert the % for you.

In other words, these two programs are equivalent:

```kcl
x = 8
  |> pow(%, exp = 2)
```

and

```kcl
x = 8
  |> pow(exp = 2) // No % needed.
```

`x` equals 64 in both these programs.

Let's see another example. We could simplify this program:
```kcl
x = 64
w = sqrt(x)
  |> sqrt(%)
  |> sqrt(%)
```

as

```kcl
x = 64
w = sqrt(x)
  |> sqrt()
  |> sqrt()
```

Both programs work the exact same -- the first unlabeled argument in `sqrt` isn't given, so it defaults to %, i.e. the left-hand side of the |> symbol. This makes your code a bit cleaner and easier to read.

With that, you've learned the basics of KCL. You know how to declare data in variables, compute new data by calling functions, and join many functions together (either using pipelines or new variables). We're ready to get into mechanical engineering. In the next chapter we'll start looking at how KCL functions can define geometric shapes for your designs and models.


