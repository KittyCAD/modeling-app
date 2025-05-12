---
title: "any"
subtitle: "Type in std::types"
excerpt: ""
layout: manual
---



The [`any`](/docs/kcl-std/types/std-types-any) type is the type of all possible values in KCL. I.e., if a function accepts an argument
with type [`any`](/docs/kcl-std/types/std-types-any), then it can accept any value.


### Examples

```kcl
fn acceptAnything(@input: any) {
  return true
}

acceptAnything(42)
acceptAnything('hello')
acceptAnything(XY)
acceptAnything([0, 1, 2])
```



