```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[58, 113, 0]"]
    5["Segment<br>[121, 177, 0]"]
    8["Segment<br>[185, 241, 0]"]
    10["Segment<br>[249, 305, 0]"]
    11["Segment<br>[313, 320, 0]"]
    13[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[58, 113, 0]"]
    6["Segment<br>[121, 177, 0]"]
    7["Segment<br>[185, 241, 0]"]
    9["Segment<br>[249, 305, 0]"]
    12["Segment<br>[313, 320, 0]"]
    14[Solid2d]
  end
  1["Plane<br>[33, 50, 0]"]
  2["Plane<br>[33, 50, 0]"]
  15["Sweep Extrusion<br>[328, 348, 0]"]
  16["Sweep Extrusion<br>[328, 348, 0]"]
  17["CompositeSolid Subtract<br>[445, 479, 0]"]
  18[Wall]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25[Wall]
  26["Cap Start"]
  27["Cap End"]
  28["Cap Start"]
  29["Cap End"]
  30["SweepEdge Opposite"]
  31["SweepEdge Adjacent"]
  32["SweepEdge Opposite"]
  33["SweepEdge Adjacent"]
  34["SweepEdge Opposite"]
  35["SweepEdge Adjacent"]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Opposite"]
  39["SweepEdge Adjacent"]
  40["SweepEdge Opposite"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Opposite"]
  43["SweepEdge Adjacent"]
  44["SweepEdge Opposite"]
  45["SweepEdge Adjacent"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 8
  3 --- 10
  3 --- 11
  3 --- 13
  3 ---- 16
  3 <--x 17
  4 --- 6
  4 --- 7
  4 --- 9
  4 --- 12
  4 --- 14
  4 ---- 15
  4 <--x 17
  5 --- 24
  5 x--> 28
  5 --- 42
  5 --- 43
  6 --- 21
  6 x--> 26
  6 --- 36
  6 --- 37
  7 --- 19
  7 x--> 26
  7 --- 32
  7 --- 33
  8 --- 25
  8 x--> 28
  8 --- 44
  8 --- 45
  9 --- 18
  9 x--> 26
  9 --- 30
  9 --- 31
  10 --- 23
  10 x--> 28
  10 --- 40
  10 --- 41
  11 --- 22
  11 x--> 28
  11 --- 38
  11 --- 39
  12 --- 20
  12 x--> 26
  12 --- 34
  12 --- 35
  15 --- 18
  15 --- 19
  15 --- 20
  15 --- 21
  15 --- 26
  15 --- 27
  15 --- 30
  15 --- 31
  15 --- 32
  15 --- 33
  15 --- 34
  15 --- 35
  15 --- 36
  15 --- 37
  16 --- 22
  16 --- 23
  16 --- 24
  16 --- 25
  16 --- 28
  16 --- 29
  16 --- 38
  16 --- 39
  16 --- 40
  16 --- 41
  16 --- 42
  16 --- 43
  16 --- 44
  16 --- 45
  30 <--x 18
  31 <--x 18
  33 <--x 18
  32 <--x 19
  33 <--x 19
  37 <--x 19
  31 <--x 20
  34 <--x 20
  35 <--x 20
  35 <--x 21
  36 <--x 21
  37 <--x 21
  30 <--x 27
  32 <--x 27
  34 <--x 27
  36 <--x 27
```
