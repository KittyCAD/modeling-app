```mermaid
flowchart LR
  subgraph path4 [Path]
    4["Path<br>[355, 396, 0]"]
    6["Segment<br>[402, 433, 0]"]
    7["Segment<br>[439, 534, 0]"]
    8["Segment<br>[540, 562, 0]"]
    9["Segment<br>[592, 599, 0]"]
    11[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[756, 806, 0]"]
    10["Segment<br>[756, 806, 0]"]
    12[Solid2d]
  end
  1["Plane<br>[332, 349, 0]"]
  2["Plane<br>[756, 806, 0]"]
  3["StartSketchOnFace<br>[713, 750, 0]"]
  13["Sweep Extrusion<br>[605, 647, 0]"]
  14["Sweep Extrusion<br>[812, 839, 0]"]
  15[Wall]
  16["Cap End"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  1 --- 4
  2 <--x 3
  2 --- 5
  10 <--x 2
  4 --- 6
  4 --- 7
  4 --- 8
  4 --- 9
  4 --- 11
  4 ---- 13
  5 --- 10
  5 --- 12
  5 ---- 14
  10 --- 15
  10 --- 17
  10 --- 18
  14 --- 15
  14 --- 16
  14 --- 17
  14 --- 18
  15 --- 17
  15 --- 18
  17 <--x 16
```
