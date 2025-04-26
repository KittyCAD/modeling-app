```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[166, 193, 0]"]
    3["Segment<br>[199, 217, 0]"]
    4["Segment<br>[223, 242, 0]"]
    5["Segment<br>[248, 267, 0]"]
    6["Segment<br>[273, 281, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[141, 160, 0]"]
  8["Sweep Extrusion<br>[287, 306, 0]"]
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
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 --- 12
  3 --- 21
  3 --- 22
  3 x--> 13
  4 --- 11
  4 --- 19
  4 --- 20
  4 x--> 13
  5 --- 10
  5 --- 17
  5 --- 18
  5 x--> 13
  6 --- 9
  6 --- 15
  6 --- 16
  6 x--> 13
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
  15 <--x 14
  16 <--x 9
  16 <--x 12
  17 <--x 10
  17 <--x 14
  18 <--x 9
  18 <--x 10
  19 <--x 11
  19 <--x 14
  20 <--x 10
  20 <--x 11
  21 <--x 12
  21 <--x 14
  22 <--x 11
  22 <--x 12
```
