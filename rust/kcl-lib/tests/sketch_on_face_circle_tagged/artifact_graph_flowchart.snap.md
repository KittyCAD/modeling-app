```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[56, 78, 0]"]
    5["Segment<br>[86, 108, 0]"]
    6["Segment<br>[116, 138, 0]"]
    7["Segment<br>[146, 169, 0]"]
    8["Segment<br>[217, 225, 0]"]
    11[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[305, 357, 0]"]
    9["Segment<br>[305, 357, 0]"]
    10[Solid2d]
  end
  1["Plane<br>[29, 48, 0]"]
  2["StartSketchOnFace<br>[263, 299, 0]"]
  12["Sweep Extrusion<br>[231, 251, 0]"]
  13["Sweep Extrusion<br>[363, 382, 0]"]
  14[Wall]
  15[Wall]
  16[Wall]
  17[Wall]
  18[Wall]
  19["Cap Start"]
  20["Cap End"]
  21["Cap Start"]
  22["Cap End"]
  23["SweepEdge Opposite"]
  24["SweepEdge Adjacent"]
  25["SweepEdge Opposite"]
  26["SweepEdge Adjacent"]
  27["SweepEdge Opposite"]
  28["SweepEdge Adjacent"]
  29["SweepEdge Opposite"]
  30["SweepEdge Adjacent"]
  31["SweepEdge Opposite"]
  32["SweepEdge Adjacent"]
  1 --- 3
  20 x--> 2
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 11
  3 ---- 12
  4 --- 9
  4 --- 10
  4 ---- 13
  20 --- 4
  5 --- 17
  5 x--> 19
  5 --- 29
  5 --- 30
  6 --- 15
  6 x--> 19
  6 --- 25
  6 --- 26
  7 --- 14
  7 x--> 19
  7 --- 23
  7 --- 24
  8 --- 16
  8 x--> 19
  8 --- 27
  8 --- 28
  9 --- 18
  9 x--> 21
  9 --- 31
  9 --- 32
  12 --- 14
  12 --- 15
  12 --- 16
  12 --- 17
  12 --- 19
  12 --- 20
  12 --- 23
  12 --- 24
  12 --- 25
  12 --- 26
  12 --- 27
  12 --- 28
  12 --- 29
  12 --- 30
  13 --- 18
  13 --- 21
  13 --- 22
  13 --- 31
  13 --- 32
  31 <--x 18
  32 <--x 18
  31 <--x 22
```
