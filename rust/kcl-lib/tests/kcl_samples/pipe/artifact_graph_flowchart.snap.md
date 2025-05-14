```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[259, 317, 0]"]
    5["Segment<br>[259, 317, 0]"]
    8[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[453, 508, 0]"]
    6["Segment<br>[453, 508, 0]"]
    7[Solid2d]
  end
  1["Plane<br>[236, 253, 0]"]
  2["StartSketchOnFace<br>[412, 447, 0]"]
  9["Sweep Extrusion<br>[323, 354, 0]"]
  10["Sweep Extrusion<br>[514, 546, 0]"]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Opposite"]
  17["SweepEdge Adjacent"]
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
  5 --- 12
  5 x--> 13
  5 --- 16
  5 --- 18
  6 --- 11
  6 x--> 14
  6 --- 15
  6 --- 17
  9 --- 12
  9 --- 13
  9 --- 14
  9 --- 16
  9 --- 18
  10 --- 11
  10 --- 15
  10 --- 17
  11 --- 15
  11 --- 17
  12 --- 16
  12 --- 18
  15 <--x 13
  16 <--x 14
```
