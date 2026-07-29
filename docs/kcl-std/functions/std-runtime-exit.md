---
title: "exit"
subtitle: "Function in std::runtime"
excerpt: "Exit the program early."
layout: manual
---

**WARNING:** This function is experimental and may change or be removed.

Exit the program early.

```kcl
exit()
```

Exiting early can be helpful to see the intermediate output of a program to
help debug. Remember to always remove the call to `exit()` after debugging
is complete.

When `exit()` is used in an imported module, only the imported module exits
early. Because imported modules execute concurrently, `exit()` in one module
does not affect other modules.

On the other hand, if you import a function from another module, and that
function calls `exit()`, then calling the function exits the caller.




