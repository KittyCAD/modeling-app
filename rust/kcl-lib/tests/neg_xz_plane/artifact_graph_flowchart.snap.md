```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[34, 59, 0]"]
    3["Segment<br>[65, 95, 0]"]
    4["Segment<br>[101, 129, 0]"]
    5["Segment<br>[135, 143, 0]"]
    6[Solid2d]
  end
  1["Plane<br>[10, 28, 0]"]
  7["Sweep Extrusion<br>[149, 172, 0]"]
  8[Wall]
  9[Wall]
  10[Wall]
  11["Cap Start"]
  12["Cap End"]
  13["SweepEdge Opposite"]
  14["SweepEdge Opposite"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Adjacent"]
  18["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 7
  3 --- 9
  3 x--> 11
  3 --- 15
  3 --- 18
  4 --- 8
  4 x--> 11
  4 --- 14
  4 --- 17
  5 --- 10
  5 x--> 11
  5 --- 13
  5 --- 16
  7 --- 8
  7 --- 9
  7 --- 10
  7 --- 11
  7 --- 12
  7 --- 13
  7 --- 14
  7 --- 15
  7 --- 16
  7 --- 17
  7 --- 18
  8 --- 14
  8 --- 17
  18 <--x 8
  9 --- 15
  16 <--x 9
  9 --- 18
  10 --- 13
  10 --- 16
  17 <--x 10
  13 <--x 12
  14 <--x 12
  15 <--x 12
```
