```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[52, 103, 0]"]
    5["Segment<br>[111, 163, 0]"]
    6["Segment<br>[171, 223, 0]"]
    7["Segment<br>[231, 283, 0]"]
    8["Segment<br>[291, 298, 0]"]
    11[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[395, 430, 0]"]
    9["Segment<br>[395, 430, 0]"]
    10[Solid2d]
  end
  1["Plane<br>[27, 44, 0]"]
  2["Plane<br>[372, 389, 0]"]
  12["Sweep Extrusion<br>[306, 326, 0]"]
  13["Sweep Extrusion<br>[436, 455, 0]"]
  14["CompositeSolid Subtract<br>[468, 504, 0]"]
  15[Wall]
  16[Wall]
  17[Wall]
  18[Wall]
  19[Wall]
  20["Cap Start"]
  21["Cap Start"]
  22["Cap End"]
  23["Cap End"]
  24["SweepEdge Opposite"]
  25["SweepEdge Opposite"]
  26["SweepEdge Opposite"]
  27["SweepEdge Opposite"]
  28["SweepEdge Opposite"]
  29["SweepEdge Adjacent"]
  30["SweepEdge Adjacent"]
  31["SweepEdge Adjacent"]
  32["SweepEdge Adjacent"]
  33["SweepEdge Adjacent"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 11
  3 ---- 12
  3 <--x 14
  4 --- 9
  4 --- 10
  4 ---- 13
  4 <--x 14
  5 --- 18
  5 x--> 21
  5 --- 25
  5 --- 29
  6 --- 16
  6 x--> 21
  6 --- 24
  6 --- 32
  7 --- 15
  7 x--> 21
  7 --- 27
  7 --- 31
  8 --- 17
  8 x--> 21
  8 --- 26
  8 --- 30
  9 --- 19
  9 x--> 20
  9 --- 28
  9 --- 33
  12 --- 15
  12 --- 16
  12 --- 17
  12 --- 18
  12 --- 21
  12 --- 23
  12 --- 24
  12 --- 25
  12 --- 26
  12 --- 27
  12 --- 29
  12 --- 30
  12 --- 31
  12 --- 32
  13 --- 19
  13 --- 20
  13 --- 22
  13 --- 28
  13 --- 33
  27 <--x 15
  31 <--x 15
  32 <--x 15
  24 <--x 16
  29 <--x 16
  32 <--x 16
  26 <--x 17
  30 <--x 17
  31 <--x 17
  25 <--x 18
  29 <--x 18
  30 <--x 18
  28 <--x 19
  33 <--x 19
  28 <--x 22
  24 <--x 23
  25 <--x 23
  26 <--x 23
  27 <--x 23
```
