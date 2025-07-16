---
title: "Python-to-KCL Cheat Sheet"
excerpt: "Table to translate Python syntax to the KCL language for the Zoo Design Studio."
layout: manual
---

| Feature | **Python** | **KCL** |
| ------- | ---------- | ------- |
| **Variable Assignment**    | `x = 42` (mutable by default)                         | `x = 42` (immutable once declared) |
| **Data Types**             | Numbers, strings, booleans, lists, tuples, dicts, None | Numbers (with units), strings, booleans, arrays, ranges (`[1..5]`), objects (`{a=1, b=2}`) |
| **Immutability**           | Variables can be reassigned. Lists and objects are mutable. | Variables cannot be reassigned. Arrays and objects are immutable. |
| **Units of Measure**       | Not supported.                                        | `12in`<br>`35mm`<br>`1m + 1ft` Units are automatically converted.<br>`cos(45deg)` Function parameters automatically convert units.<br>`arr[5_]` Unitless numbers like array indexes use the Count unit, using the underscore suffix. |
| **Conditionals**           | if/else is a statement.<pre><code>if x < 0:<br>    do_negative()<br>elif x < 10:<br>    do_less_than_ten()<br>else:<br>    do_ten_or_greater()</code></pre> | if/else is an expression that returns a result.<pre><code>result = if x < 0 {<br>  doNegative()<br>} else if x < 10 {<br>  doLessThanTen()<br>} else {<br>  doTenOrGreater()<br>}</code></pre> |
| **Functions**              | <pre><code>def add_one(arg):<br>    return arg + 1<br><br>add_one(22)</code></pre> | <pre><code>fn addOne(arg) {<br>  return arg + 1<br>}<br><br>addOne(arg = 22)</code></pre>Named keyword arguments are the default. One unlabeled parameter using `@arg` allows use with pipelines. See below. |
| **Anonymous Functions**    | `lambda x: x * x`                                       | `fn(@x) { return x * x }` |
| **Pipelines**              | Not supported. You must use nested function calls like `g(f(x))`. Sometimes you can use method chaining like `x.f().g()` if the object supports it. | `x \|> f() \|> g()` |
| **Ranges**                 | `range(5)`<br>`range(2, 5)`<br>No support for end-inclusive ranges.<br>`range(0, 10, 2)`      | `[0 ..< 5]`<br>`[2 ..< 5]`<br>`[1 .. 5]` Starts with 1 and includes 5.<br>Step other than 1 is not supported. |
| **Map a Collection**       | `list(map(lambda x: 2 * x, arr))`<br>OR<br>`[2 * x for x in arr]` | `map(arr, f = fn(@x) { return 2 * x })` |
| **Reduce a Collection**    | <pre><code>my_sum = 0<br>for item in arr:<br>    my_sum += item</code></pre> | <pre><code>mySum = reduce(arr,<br>               initial = 0,<br>               f = fn(@item, accum) { return accum + item })</code></pre> |
| **Array Concatenation**    | `[1, 2, 3] + [4, 5, 6]` | `concat([1, 2, 3], items = [4, 5, 6])` |
| **Raise to a Power**       | `2**5`                          | `2^5`<br>OR<br>`pow(2, exp = 5)` |
| **Vector Addition**        | <pre><code>a = [1, 2, 3]<br>b = [4, 5, 6]<br>result = [x + y for x, y in zip(a, b)]</code></pre>OR<pre><code>import numpy as np<br>a = np.array([1, 2, 3])<br>b = np.array([4, 5, 6])<br>result = a + b</code></pre> | <pre><code>a = [1, 2, 3]<br>b = [4, 5, 6]<br>result = vector::add(a, v = b)</code></pre> |
| **Assertion**              | `assert(my_boolean)`<br>`assert(x == 42)`<br>`assert(x > 0)` | `assertIs(myBoolean)`<br>`assert(x, isEqualTo = 42)`<br>`assert(x, isGreaterThan = 0)` |
| **Exceptions**             | <pre><code>try:<br>    raise Exception("Something unexpected")<br>except Exception as e:<br>    print(e)</code></pre> | Not supported. |
| **Modules/Imports**        | `import module`<br>`from module import x, y`            | `import "file.kcl"`<br>`import x, y from "file.kcl"`<br>Supports foreign CAD import via `import "file.obj" as mySolid` |
| **CAD Primitives**         | Not built in. Use external libs.      | `startSketchOn(...)`, `line(...)`, `elliptic(...)`, `extrude(...)`, `revolve()`, `fillet(...)`, `patternCircular3d(...)`, `union(...)`, and many more. |
