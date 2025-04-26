```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[82, 118, 6]"]
    3["Segment<br>[82, 118, 6]"]
    4[Solid2d]
  end
  1["Plane<br>[59, 76, 6]"]
  5["Sweep Extrusion<br>[124, 144, 6]"]
  6[Wall]
  7["Cap Start"]
  8["Cap End"]
  1 --- 2
  2 --- 3
  2 ---- 5
  2 --- 4
  3 --- 6
  3 x--> 7
  5 --- 6
  5 --- 7
  5 --- 8
```
