---
title: "Pipelines"
excerpt: "Documentation of the KCL language for the Zoo Design Studio."
layout: manual
---

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
