```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[56, 78, 0]"]
    3["Segment<br>[86, 108, 0]"]
    4["Segment<br>[116, 138, 0]"]
    5["Segment<br>[146, 169, 0]"]
    6["Segment<br>[217, 225, 0]"]
    7[Solid2d]
  end
  subgraph path18 [Path]
    18["Path<br>[305, 357, 0]"]
    19["Segment<br>[305, 357, 0]"]
    20[Solid2d]
  end
  1["Plane<br>[29, 48, 0]"]
  8["Sweep Extrusion<br>[231, 251, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Opposite"]
  17["SweepEdge Opposite"]
  21["Sweep Extrusion<br>[363, 382, 0]"]
  22[Wall]
  23["Cap Start"]
  24["Cap End"]
  25["StartSketchOnFace<br>[263, 299, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 --- 12
  3 --- 17
  3 x--> 13
  4 --- 11
  4 --- 16
  4 x--> 13
  5 --- 10
  5 --- 15
  5 x--> 13
  6 --- 9
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
  14 --- 18
  15 <--x 10
  15 <--x 14
  16 <--x 11
  16 <--x 14
  17 <--x 12
  17 <--x 14
  18 --- 19
  18 ---- 21
  18 --- 20
  19 --- 22
  19 x--> 23
  21 --- 22
  21 --- 23
  21 --- 24
  14 <--x 25
```
