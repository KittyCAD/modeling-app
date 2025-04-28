```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[35, 60, 0]"]
    3["Segment<br>[66, 99, 0]"]
    4["Segment<br>[105, 139, 0]"]
    5["Segment<br>[145, 180, 0]"]
    6["Segment<br>[186, 206, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[10, 29, 0]"]
  8["Sweep Extrusion<br>[212, 232, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  23["EdgeCut Fillet<br>[238, 298, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
  3 --- 12
  3 x--> 13
  3 --- 21
  3 --- 22
  4 --- 10
  4 x--> 13
  4 --- 17
  4 --- 18
  5 --- 9
  5 x--> 13
  5 --- 15
  5 --- 16
  6 --- 11
  6 x--> 13
  6 --- 19
  6 --- 20
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
  15 <--x 9
  16 <--x 9
  18 <--x 9
  17 <--x 10
  18 <--x 10
  22 <--x 10
  16 <--x 11
  19 <--x 11
  20 <--x 11
  20 <--x 12
  21 <--x 12
  22 <--x 12
  15 <--x 14
  17 <--x 14
  19 <--x 14
  21 <--x 14
  16 <--x 23
```
