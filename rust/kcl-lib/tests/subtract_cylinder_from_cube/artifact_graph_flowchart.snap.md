```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[52, 103, 0]"]
    3["Segment<br>[111, 163, 0]"]
    4["Segment<br>[171, 223, 0]"]
    5["Segment<br>[231, 283, 0]"]
    6["Segment<br>[291, 298, 0]"]
    7[Solid2d]
  end
  subgraph path24 [Path]
    24["Path<br>[388, 423, 0]"]
    25["Segment<br>[388, 423, 0]"]
    26[Solid2d]
  end
  1["Plane<br>[27, 44, 0]"]
  8["Sweep Extrusion<br>[306, 326, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  23["Plane<br>[363, 382, 0]"]
  27["Sweep Extrusion<br>[429, 448, 0]"]
  28[Wall]
  29["Cap Start"]
  30["Cap End"]
  31["SweepEdge Opposite"]
  32["SweepEdge Adjacent"]
  33["CompositeSolid Subtract<br>[461, 497, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 --- 9
  3 --- 15
  3 --- 16
  3 x--> 13
  4 --- 10
  4 --- 17
  4 --- 18
  4 x--> 13
  5 --- 11
  5 --- 19
  5 --- 20
  5 x--> 13
  6 --- 12
  6 --- 21
  6 --- 22
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
  8 --- 18
  8 --- 19
  8 --- 20
  8 --- 21
  8 --- 22
  15 <--x 9
  15 <--x 14
  16 <--x 9
  16 <--x 10
  17 <--x 10
  17 <--x 14
  18 <--x 10
  18 <--x 11
  19 <--x 11
  19 <--x 14
  20 <--x 11
  20 <--x 12
  21 <--x 12
  21 <--x 14
  22 <--x 9
  22 <--x 12
  23 --- 24
  24 --- 25
  24 ---- 27
  24 --- 26
  25 --- 28
  25 --- 31
  25 --- 32
  25 x--> 29
  27 --- 28
  27 --- 29
  27 --- 30
  27 --- 31
  27 --- 32
  31 <--x 28
  31 <--x 30
  32 <--x 28
  2 <--x 33
  24 <--x 33
```
