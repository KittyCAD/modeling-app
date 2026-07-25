---
title: "never"
subtitle: "Type in std::types"
excerpt: "The uninhabited type of computations that never complete normally."
layout: manual
---

**WARNING:** This type is experimental and may change or be removed.

The uninhabited type of computations that never complete normally.

[`never`](/docs/kcl-std/types/std-types-never) has no values and is a subtype of every type. Use it as the return
type of a function that always stops evaluation by raising an error. A
function declared to return [`never`](/docs/kcl-std/types/std-types-never) produces a type error if it returns a
value or reaches the end of its body.



