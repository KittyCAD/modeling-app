```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[722, 773, 0]"]
    3["Segment<br>[722, 773, 0]"]
    4[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[797, 848, 0]"]
    6["Segment<br>[797, 848, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[699, 716, 0]"]
  8["Sweep Extrusion<br>[860, 904, 0]"]
  9[Wall]
  10["Cap Start"]
  11["Cap End"]
  12["SweepEdge Opposite"]
  13["SweepEdge Adjacent"]
  1 --- 2
  1 --- 5
  2 --- 3
  2 ---- 8
  2 --- 4
  3 --- 9
  3 --- 12
  3 --- 13
  3 x--> 10
  5 --- 6
  5 --- 7
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  12 <--x 9
  12 <--x 11
  13 <--x 9
```
