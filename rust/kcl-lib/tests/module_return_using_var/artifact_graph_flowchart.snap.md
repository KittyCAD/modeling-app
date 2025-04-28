```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[80, 105, 8]"]
    3["Segment<br>[111, 128, 8]"]
    4["Segment<br>[134, 151, 8]"]
    5["Segment<br>[157, 175, 8]"]
    6["Segment<br>[181, 199, 8]"]
    7["Segment<br>[205, 213, 8]"]
    8[Solid2d]
  end
  1["Plane<br>[57, 74, 8]"]
  9["Sweep Extrusion<br>[219, 238, 8]"]
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
  2 --- 8
  2 ---- 9
  3 --- 11
  3 x--> 14
  3 --- 18
  3 --- 19
  4 --- 12
  4 x--> 14
  4 --- 20
  4 --- 21
  5 --- 13
  5 x--> 14
  5 --- 22
  5 --- 23
  6 --- 10
  6 x--> 14
  6 --- 16
  6 --- 17
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
  17 <--x 10
  23 <--x 10
  17 <--x 11
  18 <--x 11
  19 <--x 11
  19 <--x 12
  20 <--x 12
  21 <--x 12
  21 <--x 13
  22 <--x 13
  23 <--x 13
  16 <--x 15
  18 <--x 15
  20 <--x 15
  22 <--x 15
```
