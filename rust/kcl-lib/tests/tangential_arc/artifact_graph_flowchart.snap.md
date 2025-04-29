```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[35, 60, 0]"]
    3["Segment<br>[66, 85, 0]"]
    4["Segment<br>[91, 128, 0]"]
    5["Segment<br>[134, 154, 0]"]
  end
  1["Plane<br>[12, 29, 0]"]
  6["Sweep Extrusion<br>[160, 180, 0]"]
  7[Wall]
  8[Wall]
  9[Wall]
  10["Cap Start"]
  11["Cap End"]
  12["SweepEdge Opposite"]
  13["SweepEdge Adjacent"]
  14["SweepEdge Opposite"]
  15["SweepEdge Adjacent"]
  16["SweepEdge Opposite"]
  17["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 ---- 6
  3 --- 7
  3 --- 12
  3 --- 13
  3 x--> 10
  4 --- 8
  4 --- 14
  4 --- 15
  4 x--> 10
  5 --- 9
  5 --- 16
  5 --- 17
  5 x--> 10
  6 --- 7
  6 --- 8
  6 --- 9
  6 --- 10
  6 --- 11
  6 --- 12
  6 --- 13
  6 --- 14
  6 --- 15
  6 --- 16
  6 --- 17
  12 <--x 7
  12 <--x 11
  13 <--x 7
  13 <--x 8
  14 <--x 8
  14 <--x 11
  15 <--x 8
  15 <--x 9
  16 <--x 9
  16 <--x 11
  17 <--x 7
  17 <--x 9
```
