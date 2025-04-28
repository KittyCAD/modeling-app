```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[80, 105, 7]"]
    3["Segment<br>[111, 128, 7]"]
    4["Segment<br>[134, 151, 7]"]
    5["Segment<br>[157, 175, 7]"]
    6["Segment<br>[181, 199, 7]"]
    7["Segment<br>[205, 213, 7]"]
    8[Solid2d]
  end
  1["Plane<br>[57, 74, 7]"]
  9["Sweep Extrusion<br>[219, 238, 7]"]
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
  3 x--> 14
  4 --- 11
  4 --- 18
  4 --- 19
  4 x--> 14
  5 --- 12
  5 --- 20
  5 --- 21
  5 x--> 14
  6 --- 13
  6 --- 22
  6 --- 23
  6 x--> 14
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
  16 <--x 10
  16 <--x 15
  17 <--x 10
  17 <--x 11
  18 <--x 11
  18 <--x 15
  19 <--x 11
  19 <--x 12
  20 <--x 12
  20 <--x 15
  21 <--x 12
  21 <--x 13
  22 <--x 13
  22 <--x 15
  23 <--x 10
  23 <--x 13
```
