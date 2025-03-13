```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[202, 223, 0]"]
    3["Segment<br>[231, 253, 0]"]
    4["Segment<br>[351, 358, 0]"]
    5[Solid2d]
  end
  1["Plane<br>[177, 194, 0]"]
  6["Sweep Extrusion<br>[366, 390, 0]"]
  7[Wall]
  8["Cap Start"]
  9["Cap End"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 ---- 6
  2 --- 5
  3 --- 7
  6 --- 7
  6 --- 8
  6 --- 9
```
