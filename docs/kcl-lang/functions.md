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

Functions can also declare one *unlabeled* arg. If you do want to declare an unlabeled arg, it must
be the first arg declared.

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
