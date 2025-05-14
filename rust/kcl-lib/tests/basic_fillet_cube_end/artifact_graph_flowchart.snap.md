```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[33, 58, 0]"]
    3["Segment<br>[64, 97, 0]"]
    4["Segment<br>[103, 122, 0]"]
    5["Segment<br>[128, 163, 0]"]
    6["Segment<br>[169, 177, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[10, 27, 0]"]
  8["Sweep Extrusion<br>[183, 203, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Opposite"]
  17["SweepEdge Opposite"]
  18["SweepEdge Opposite"]
  19["SweepEdge Adjacent"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Adjacent"]
  22["SweepEdge Adjacent"]
  23["EdgeCut Fillet<br>[209, 267, 0]"]
  24["EdgeCut Fillet<br>[209, 267, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
  3 --- 12
  3 x--> 13
  3 --- 18
  3 --- 22
  3 --- 24
  4 --- 10
  4 x--> 13
  4 --- 17
  4 --- 21
  5 --- 9
  5 x--> 13
  5 --- 16
  5 --- 20
  6 --- 11
  6 x--> 13
  6 --- 15
  6 --- 19
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  8 --- 14
  8 --- 15
  8 --- 16
  8 --- 17
  8 --- 18
  8 --- 19
  8 --- 20
  8 --- 21
  8 --- 22
  9 --- 16
  9 --- 20
  21 <--x 9
  10 --- 17
  10 --- 21
  22 <--x 10
  11 --- 15
  11 --- 19
  20 <--x 11
  12 --- 18
  19 <--x 12
  12 --- 22
  15 <--x 14
  16 <--x 14
  17 <--x 14
  18 <--x 14
  18 <--x 23
```
