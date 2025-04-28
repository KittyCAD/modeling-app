```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[337, 378, 0]"]
    3["Segment<br>[384, 415, 0]"]
    4["Segment<br>[421, 516, 0]"]
    5["Segment<br>[522, 544, 0]"]
    6["Segment<br>[574, 581, 0]"]
    7[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[738, 788, 0]"]
    11["Segment<br>[738, 788, 0]"]
    12[Solid2d]
  end
  1["Plane<br>[314, 331, 0]"]
  8["Sweep Extrusion<br>[587, 629, 0]"]
  9["Plane<br>[738, 788, 0]"]
  13["Sweep Extrusion<br>[794, 821, 0]"]
  14[Wall]
  15["Cap End"]
  16["SweepEdge Opposite"]
  17["SweepEdge Adjacent"]
  18["StartSketchOnFace<br>[695, 732, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  9 --- 10
  10 --- 11
  10 ---- 13
  10 --- 12
  11 --- 14
  11 --- 16
  11 --- 17
  11 <--x 9
  13 --- 14
  13 --- 15
  13 --- 16
  13 --- 17
  16 <--x 14
  16 <--x 15
  17 <--x 14
  9 <--x 18
```
