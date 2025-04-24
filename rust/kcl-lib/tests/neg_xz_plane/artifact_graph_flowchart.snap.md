```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[36, 61, 0]"]
    3["Segment<br>[67, 97, 0]"]
    4["Segment<br>[103, 131, 0]"]
    5["Segment<br>[137, 145, 0]"]
    6[Solid2d]
  end
  1["Plane<br>[10, 30, 0]"]
  7["Sweep Extrusion<br>[151, 174, 0]"]
  8[Wall]
  9[Wall]
  10[Wall]
  11["Cap Start"]
  12["Cap End"]
  13["SweepEdge Opposite"]
  14["SweepEdge Opposite"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 ---- 7
  2 --- 6
  3 --- 10
  3 --- 14
  3 x--> 11
  4 --- 9
  4 --- 13
  4 x--> 11
  5 --- 8
  5 x--> 11
  7 --- 8
  7 --- 9
  7 --- 10
  7 --- 11
  7 --- 12
  7 --- 13
  7 --- 14
  13 <--x 9
  13 <--x 12
  14 <--x 10
  14 <--x 12
```
