---
title: "Python-to-KCL Cheat Sheet"
excerpt: "Table to translate Python syntax to the KCL language for the Zoo Design Studio."
layout: manual
---

| Feature | **Python** | **KCL** |
| ------- | ---------- | ------- |
| **Variable Assignment**    | Can be reassigned later.<br/>`x = 42` | Cannot be reassigned once declared.<br/>`x = 42` |
| **Data Types**             | Numbers, strings, booleans, lists, tuples, dicts, objects, None | Numbers (with units), strings, booleans, arrays, objects |
| **Immutability**           | Variables can be reassigned. Lists, dicts, and objects are mutable. | Variables cannot be reassigned. Arrays and objects are immutable. |
| **Units of Measure**       | Not supported.                                        | `12in`<br/>`35mm`<br/>`1m + 1ft` Units are automatically converted.<br/>`cos(45deg)` Function parameters automatically convert units.<br/>`arr[5_]` Unitless numbers like array indexes use the Count unit, using the underscore suffix. |
| **Conditionals**           | if/else is a statement.<pre><code>if x < 0:<br/>    do_negative()<br/>elif x < 10:<br/>    do_less_than_ten()<br/>else:<br/>    do_ten_or_greater()</code></pre> | if/else is an expression that returns a result. `if` expressions require a matching `else`. <pre><code>result = if x < 0 &lbrace;<br/>  doNegative()<br/>&rbrace; else if x < 10 &lbrace;<br/>  doLessThanTen()<br/>&rbrace; else &lbrace;<br/>  doTenOrGreater()<br/>&rbrace;</code></pre> |
| **Functions with Named Parameters** | When calling a function, parameters can be named or positional.<pre><code>def make_vector(x, y):<br/>    return [x, y]<br/><br/>make_vector(10, 5)<br/>make_vector(x = 10, y = 5)</code></pre> | When calling a function, parameters must be named. <pre><code>fn makeVector(x, y) &lbrace;<br/>  return [x, y]<br/>&rbrace;<br/><br/>makeVector(x = 10, y = 5)</code></pre> |
| **Functions with Positional-Only Parameters** | Some parameters can be declared as positional-only. <pre><code>def make_vector(x, y, /):<br/>    return [x, y]<br/><br/>make_vector(10, 5)</code></pre> | The first, and only first, parameter can optionally be declared with an `@` prefix, meaning that it's unnamed and positional-only. This allows it to work with pipelines. See below. <pre><code>fn makeVector(@x, y) &lbrace;<br/>  return [x, y]<br/>&rbrace;<br/><br/>makeVector(10, y = 5)</code></pre> |
| **Anonymous Functions**    | `lambda x: x * x`                                       | `fn(@x) { return x * x }` |
| **Pipelines**              | Not supported. You must use nested function calls like `g(f(x))`. Sometimes you can use method chaining like `x.f().g()` if the object supports it. | The value on the left of the `\|>` is substituted for the first positional-only parameter on the right.<br/>`x \|> f() \|> g()` |
| **Ranges**                 | `range(5)`<br/>`range(2, 5)`<br/>No support for end-inclusive ranges.<br/>`range(0, 10, 2)`      | `[0 ..< 5]`<br/>`[2 ..< 5]`<br/>`[1 .. 5]` Starts with 1 and includes 5.<br/>Step other than 1 is not supported. |
| **Map a Collection**       | `list(map(lambda x: 2 * x, arr))`<br/>OR<br/>`[2 * x for x in arr]` | `map(arr, f = fn(@x) { return 2 * x })` |
| **Reduce a Collection**    | <pre><code>result = 0<br/>for item in arr:<br/>    result += 2 * item</code></pre>OR<pre><code>from functools import reduce<br/>result = reduce(lambda sum, item: sum + 2 * item, arr, 0)</code></pre> | The accumulator parameter must be named `accum`. <pre><code>result = reduce(arr,<br/>               initial = 0,<br/>               f = fn(@item, accum) &lbrace; return accum + 2 * item &rbrace;)</code></pre> |
| **Array Concatenation**    | `[1, 2, 3] + [4, 5, 6]` | `concat([1, 2, 3], items = [4, 5, 6])` |
| **Raise to a Power**       | `2**5`                          | `2^5`<br/>OR<br/>`pow(2, exp = 5)` |
| **Vector Addition**        | <pre><code>a = [1, 2, 3]<br/>b = [4, 5, 6]<br/>result = [x + y for x, y in zip(a, b)]</code></pre>OR<pre><code>import numpy as np<br/>a = np.array([1, 2, 3])<br/>b = np.array([4, 5, 6])<br/>result = a + b</code></pre> | <pre><code>a = [1, 2, 3]<br/>b = [4, 5, 6]<br/>result = vector::add(a, v = b)</code></pre> |
| **Logical Operators**      | Short circuits.<br/>`a and b`<br/>`a or b`<br/>`not a` | Does not short circuit. See [docs](/docs/kcl-lang/arithmetic).<br/>`a & b`<br/>`a \| b`<br/>`!a` |
| **Assertion**              | `assert(my_boolean)`<br/>`assert(x == 42)`<br/>`assert(x > 0)` | `assertIs(myBoolean)`<br/>Numbers should use the special [`assert()`](/docs/kcl-std/functions/std-assert) function with the correct parameters so that the error message can include the actual numeric value.<br/>`assert(x, isEqualTo = 42)`<br/>`assert(x, isGreaterThan = 0)` |
| **Exceptions**             | <pre><code>try:<br/>    raise Exception("Something unexpected")<br/>except Exception as e:<br/>    print(e)</code></pre> | Not supported. |
| **Modules/Imports**        | `import module`<br/>`import module as alias`<br/>`from module import x, y`            | `import "file.kcl"`<br/>`import "file.kcl" as alias`<br/>`import x, y from "file.kcl"`<br/>Supports other CAD format imports. See [docs](/docs/kcl-lang/foreign-imports).<br/>`import "file.obj"` |
| **CAD Primitives**         | Not built in. Use external libs.      | `startSketchOn(...)`, `line(...)`, `elliptic(...)`, `extrude(...)`, `revolve()`, `fillet(...)`, `patternCircular3d(...)`, `union(...)`, and many more. |
