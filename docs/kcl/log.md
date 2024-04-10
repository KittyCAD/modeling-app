---
title: "log"
excerpt: "Computes the logarithm of the number with respect to an arbitrary base."
layout: manual
---

Computes the logarithm of the number with respect to an arbitrary base.

The result might not be correctly rounded owing to implementation details; `log2()` can produce more accurate results for base 2, and `log10()` can produce more accurate results for base 10.

```js
log(num: number, base: number) -> number
```

### Tags

* `math`

### Examples

```js
const myVar = log(4, 2)
```

### Arguments

* `num`: `number` (REQUIRED)
* `base`: `number` (REQUIRED)

### Returns

`number`



