---
title: "lastSegX"
subtitle: "Function in std::sketch"
excerpt: "Extract the 'x' axis value of the last line segment in the provided 2-d sketch."
layout: manual
---

Extract the 'x' axis value of the last line segment in the provided 2-d sketch.

```kcl
lastSegX(@sketch: Sketch): number(Length)
```



### Arguments

| Name | Type | Description | Required |
|----------|------|-------------|----------|
| `sketch` | [`Sketch`](/docs/kcl-std/types/std-types-Sketch) | The sketch whose line segment is being queried. | Yes |

### Returns

[`number(Length)`](/docs/kcl-std/types/std-types-number) - A number.


### Examples

```kcl
exampleSketch = startSketchOn(XZ)
  |> startProfile(at = [0, 0])
  |> line(end = [5, 0])
  |> line(end = [20, 5])
  |> line(end = [lastSegX(%), 0])
  |> line(end = [-15, 0])
  |> close()

example = extrude(exampleSketch, length = 5)

```


![Rendered example of lastSegX 0](/kcl-test-outputs/serial_test_example_fn_std-sketch-lastSegX0.png)


