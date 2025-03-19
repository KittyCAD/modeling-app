```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[429, 508, 0]"]
    3["Segment<br>[429, 508, 0]"]
    4[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[568, 647, 0]"]
    6["Segment<br>[568, 647, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[350, 369, 0]"]
  8["Sweep Revolve<br>[794, 845, 0]"]
  9[Wall]
  10["Cap Start"]
  11["Cap End"]
  12["SweepEdge Opposite"]
  13["SweepEdge Adjacent"]
  1 --- 2
  1 --- 5
  2 --- 3
  2 ---- 8
  2 --- 4
  3 --- 9
  3 --- 12
  3 --- 13
  5 --- 6
  5 --- 7
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
```
