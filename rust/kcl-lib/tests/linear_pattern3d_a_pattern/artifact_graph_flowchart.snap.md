```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[41, 66, 0]"]
    3["Segment<br>[72, 90, 0]"]
    4["Segment<br>[145, 153, 0]"]
    5[Solid2d]
  end
  1["Plane<br>[16, 35, 0]"]
  6["Sweep Extrusion<br>[159, 178, 0]"]
  7[Wall]
  8[Wall]
  9["Cap Start"]
  10["Cap End"]
  11["SweepEdge Opposite"]
  12["SweepEdge Adjacent"]
  13["SweepEdge Opposite"]
  14["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 ---- 6
  2 --- 5
  3 --- 8
  3 --- 13
  3 --- 14
  4 --- 7
  4 --- 11
  4 --- 12
  6 --- 7
  6 --- 8
  6 --- 9
  6 --- 10
  6 --- 11
  6 --- 12
  6 --- 13
  6 --- 14
```
