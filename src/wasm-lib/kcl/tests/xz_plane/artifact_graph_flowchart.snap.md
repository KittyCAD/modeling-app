```mermaid
flowchart LR
  1["Plane<br>[10, 29, 0]"]
  2["Path<br>[35, 60, 0]"]
  3["Segment<br>[66, 87, 0]"]
  4["Segment<br>[93, 112, 0]"]
  5["Segment<br>[118, 126, 0]"]
  6[Solid2d]
  7["Sweep Extrusion<br>[132, 149, 0]"]
  8[Wall]
  9[Wall]
  10[Wall]
  11["Cap Start"]
  12["Cap End"]
  13["SweepEdge Opposite"]
  14["SweepEdge Adjacent"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  1 --- 2
  2 --- 1
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 7
  2 --- 6
  3 --- 2
  3 --- 10
  3 --- 17
  3 --- 18
  4 --- 2
  4 --- 9
  4 --- 15
  4 --- 16
  5 --- 2
  5 --- 8
  5 --- 13
  5 --- 14
  6 --- 2
  7 --- 2
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
  8 --- 5
  8 --- 7
  9 --- 4
  9 --- 7
  10 --- 3
  10 --- 7
  11 --- 7
  12 --- 7
  13 --- 5
  13 --- 7
  14 --- 5
  14 --- 7
  15 --- 4
  15 --- 7
  16 --- 4
  16 --- 7
  17 --- 3
  17 --- 7
  18 --- 3
  18 --- 7
```
