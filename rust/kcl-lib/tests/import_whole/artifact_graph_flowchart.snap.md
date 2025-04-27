```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[82, 118, 6]"]
    3["Segment<br>[82, 118, 6]"]
    4[Solid2d]
  end
  1["Plane<br>[59, 76, 6]"]
  5["Sweep Extrusion<br>[124, 144, 6]"]
  6[Wall]
  7["Cap Start"]
  8["Cap End"]
  9["SweepEdge Opposite"]
  10["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 ---- 5
  2 --- 4
  3 --- 6
  3 --- 9
  3 --- 10
  3 x--> 7
  5 --- 6
  5 --- 7
  5 --- 8
  5 --- 9
  5 --- 10
  9 <--x 6
  9 <--x 8
  10 <--x 6
```
