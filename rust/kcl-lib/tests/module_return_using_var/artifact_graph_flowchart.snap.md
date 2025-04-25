```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[80, 105, 6]"]
    3["Segment<br>[111, 128, 6]"]
    4["Segment<br>[134, 151, 6]"]
    5["Segment<br>[157, 175, 6]"]
    6["Segment<br>[181, 199, 6]"]
    7["Segment<br>[205, 213, 6]"]
    8[Solid2d]
  end
  1["Plane<br>[57, 74, 6]"]
  9["Sweep Extrusion<br>[219, 238, 6]"]
  10[Wall]
  11[Wall]
  12[Wall]
  13[Wall]
  14["Cap Start"]
  15["Cap End"]
  16["SweepEdge Opposite"]
  17["SweepEdge Adjacent"]
  18["SweepEdge Opposite"]
  19["SweepEdge Adjacent"]
  20["SweepEdge Opposite"]
  21["SweepEdge Adjacent"]
  22["SweepEdge Opposite"]
  23["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 9
  2 --- 8
  3 --- 10
  3 --- 16
  3 --- 17
  4 --- 11
  4 --- 18
  4 --- 19
  5 --- 12
  5 --- 20
  5 --- 21
  6 --- 13
  6 --- 22
  6 --- 23
  9 --- 10
  9 --- 11
  9 --- 12
  9 --- 13
  9 --- 14
  9 --- 15
  9 --- 16
  9 --- 17
  9 --- 18
  9 --- 19
  9 --- 20
  9 --- 21
  9 --- 22
  9 --- 23
```
