```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[241, 299, 0]"]
    5["Segment<br>[241, 299, 0]"]
    8[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[435, 490, 0]"]
    6["Segment<br>[435, 490, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[218, 235, 0]"]
  2["StartSketchOnFace<br>[394, 429, 0]"]
  9["Sweep Extrusion<br>[305, 336, 0]"]
  10["Sweep Extrusion<br>[496, 528, 0]"]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  1 --- 3
  14 x--> 2
  3 --- 5
  3 --- 8
  3 ---- 9
  4 --- 6
  4 --- 7
  4 ---- 10
  14 --- 4
  5 --- 11
  5 x--> 13
  5 --- 15
  5 --- 16
  6 --- 12
  6 x--> 14
  6 --- 17
  6 --- 18
  9 --- 11
  9 --- 13
  9 --- 14
  9 --- 15
  9 --- 16
  10 --- 12
  10 --- 17
  10 --- 18
  15 <--x 11
  16 <--x 11
  17 <--x 12
  18 <--x 12
  17 <--x 13
  15 <--x 14
```
