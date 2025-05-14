```mermaid
flowchart LR
  subgraph path5 [Path]
    5["Path<br>[818, 843, 0]"]
    7["Segment<br>[851, 873, 0]"]
    9["Segment<br>[881, 925, 0]"]
    12["Segment<br>[933, 960, 0]"]
    13["Segment<br>[968, 1012, 0]"]
    15["Segment<br>[1020, 1027, 0]"]
    17[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[818, 843, 0]"]
    8["Segment<br>[851, 873, 0]"]
    10["Segment<br>[881, 925, 0]"]
    11["Segment<br>[933, 960, 0]"]
    14["Segment<br>[968, 1012, 0]"]
    16["Segment<br>[1020, 1027, 0]"]
    18[Solid2d]
  end
  1["Plane<br>[1113, 1151, 0]"]
  2["Plane<br>[1607, 1645, 0]"]
  3["StartSketchOnPlane<br>[790, 810, 0]"]
  4["StartSketchOnPlane<br>[790, 810, 0]"]
  19["Sweep Extrusion<br>[1100, 1194, 0]"]
  20["Sweep Revolve<br>[1594, 1676, 0]"]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25[Wall]
  26[Wall]
  27[Wall]
  28[Wall]
  29[Wall]
  30[Wall]
  31["Cap Start"]
  32["Cap Start"]
  33["Cap End"]
  34["Cap End"]
  35["SweepEdge Opposite"]
  36["SweepEdge Opposite"]
  37["SweepEdge Opposite"]
  38["SweepEdge Opposite"]
  39["SweepEdge Opposite"]
  40["SweepEdge Opposite"]
  41["SweepEdge Opposite"]
  42["SweepEdge Opposite"]
  43["SweepEdge Opposite"]
  44["SweepEdge Opposite"]
  45["SweepEdge Adjacent"]
  46["SweepEdge Adjacent"]
  47["SweepEdge Adjacent"]
  48["SweepEdge Adjacent"]
  49["SweepEdge Adjacent"]
  50["SweepEdge Adjacent"]
  51["SweepEdge Adjacent"]
  52["SweepEdge Adjacent"]
  53["SweepEdge Adjacent"]
  54["SweepEdge Adjacent"]
  1 <--x 3
  1 --- 6
  2 <--x 4
  2 --- 5
  5 --- 7
  5 --- 9
  5 --- 12
  5 --- 13
  5 --- 15
  5 --- 17
  5 ---- 20
  6 --- 8
  6 --- 10
  6 --- 11
  6 --- 14
  6 --- 16
  6 --- 18
  6 ---- 19
  7 --- 24
  7 x--> 31
  7 --- 35
  7 --- 45
  8 --- 28
  8 x--> 32
  8 --- 44
  8 --- 54
  9 --- 22
  9 x--> 31
  9 --- 36
  9 --- 46
  10 --- 27
  10 x--> 32
  10 --- 43
  10 --- 53
  11 --- 26
  11 x--> 32
  11 --- 42
  11 --- 52
  12 --- 23
  12 x--> 31
  12 --- 37
  12 --- 47
  13 --- 21
  13 x--> 31
  13 --- 38
  13 --- 48
  14 --- 29
  14 x--> 32
  14 --- 41
  14 --- 51
  15 --- 25
  15 x--> 31
  15 --- 39
  15 --- 49
  16 --- 30
  16 x--> 32
  16 --- 40
  16 --- 50
  19 --- 26
  19 --- 27
  19 --- 28
  19 --- 29
  19 --- 30
  19 --- 32
  19 --- 34
  19 --- 40
  19 --- 41
  19 --- 42
  19 --- 43
  19 --- 44
  19 --- 50
  19 --- 51
  19 --- 52
  19 --- 53
  19 --- 54
  20 --- 21
  20 --- 22
  20 --- 23
  20 --- 24
  20 --- 25
  20 --- 31
  20 --- 33
  20 --- 35
  20 --- 36
  20 --- 37
  20 --- 38
  20 --- 39
  20 --- 45
  20 --- 46
  20 --- 47
  20 --- 48
  20 --- 49
  21 --- 38
  47 <--x 21
  21 --- 48
  22 --- 36
  45 <--x 22
  22 --- 46
  23 --- 37
  46 <--x 23
  23 --- 47
  24 --- 35
  24 --- 45
  49 <--x 24
  25 --- 39
  48 <--x 25
  25 --- 49
  26 --- 42
  26 --- 52
  53 <--x 26
  27 --- 43
  27 --- 53
  54 <--x 27
  28 --- 44
  50 <--x 28
  28 --- 54
  29 --- 41
  29 --- 51
  52 <--x 29
  30 --- 40
  30 --- 50
  51 <--x 30
  35 <--x 33
  36 <--x 33
  37 <--x 33
  38 <--x 33
  39 <--x 33
  40 <--x 34
  41 <--x 34
  42 <--x 34
  43 <--x 34
  44 <--x 34
```
