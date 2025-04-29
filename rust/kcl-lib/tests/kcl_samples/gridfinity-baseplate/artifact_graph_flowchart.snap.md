```mermaid
flowchart LR
  subgraph path5 [Path]
    5["Path<br>[799, 824, 0]"]
    7["Segment<br>[832, 854, 0]"]
    10["Segment<br>[862, 906, 0]"]
    12["Segment<br>[914, 941, 0]"]
    14["Segment<br>[949, 993, 0]"]
    16["Segment<br>[1001, 1008, 0]"]
    17[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[799, 824, 0]"]
    8["Segment<br>[832, 854, 0]"]
    9["Segment<br>[862, 906, 0]"]
    11["Segment<br>[914, 941, 0]"]
    13["Segment<br>[949, 993, 0]"]
    15["Segment<br>[1001, 1008, 0]"]
    18[Solid2d]
  end
  1["Plane<br>[1094, 1132, 0]"]
  2["Plane<br>[1588, 1626, 0]"]
  3["StartSketchOnPlane<br>[771, 791, 0]"]
  4["StartSketchOnPlane<br>[771, 791, 0]"]
  19["Sweep Extrusion<br>[1081, 1175, 0]"]
  20["Sweep Revolve<br>[1575, 1657, 0]"]
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
  32["Cap End"]
  33["Cap Start"]
  34["Cap End"]
  35["SweepEdge Opposite"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Opposite"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Opposite"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Opposite"]
  44["SweepEdge Adjacent"]
  45["SweepEdge Opposite"]
  46["SweepEdge Adjacent"]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["SweepEdge Opposite"]
  50["SweepEdge Adjacent"]
  51["SweepEdge Opposite"]
  52["SweepEdge Adjacent"]
  53["SweepEdge Opposite"]
  54["SweepEdge Adjacent"]
  1 <--x 4
  1 --- 5
  2 <--x 3
  2 --- 6
  5 --- 7
  5 --- 10
  5 --- 12
  5 --- 14
  5 --- 16
  5 --- 17
  5 ---- 19
  6 --- 8
  6 --- 9
  6 --- 11
  6 --- 13
  6 --- 15
  6 --- 18
  6 ---- 20
  7 --- 22
  7 x--> 31
  7 --- 37
  7 --- 38
  8 --- 28
  8 x--> 33
  8 --- 49
  8 --- 50
  9 --- 26
  9 x--> 33
  9 --- 45
  9 --- 46
  10 --- 21
  10 x--> 31
  10 --- 35
  10 --- 36
  11 --- 27
  11 x--> 33
  11 --- 47
  11 --- 48
  12 --- 23
  12 x--> 31
  12 --- 39
  12 --- 40
  13 --- 29
  13 x--> 33
  13 --- 51
  13 --- 52
  14 --- 25
  14 x--> 31
  14 --- 43
  14 --- 44
  15 --- 30
  15 x--> 33
  15 --- 53
  15 --- 54
  16 --- 24
  16 x--> 31
  16 --- 41
  16 --- 42
  19 --- 21
  19 --- 22
  19 --- 23
  19 --- 24
  19 --- 25
  19 --- 31
  19 --- 32
  19 --- 35
  19 --- 36
  19 --- 37
  19 --- 38
  19 --- 39
  19 --- 40
  19 --- 41
  19 --- 42
  19 --- 43
  19 --- 44
  20 --- 26
  20 --- 27
  20 --- 28
  20 --- 29
  20 --- 30
  20 --- 33
  20 --- 34
  20 --- 45
  20 --- 46
  20 --- 47
  20 --- 48
  20 --- 49
  20 --- 50
  20 --- 51
  20 --- 52
  20 --- 53
  20 --- 54
  35 <--x 21
  36 <--x 21
  38 <--x 21
  37 <--x 22
  38 <--x 22
  42 <--x 22
  36 <--x 23
  39 <--x 23
  40 <--x 23
  41 <--x 24
  42 <--x 24
  44 <--x 24
  40 <--x 25
  43 <--x 25
  44 <--x 25
  45 <--x 26
  46 <--x 26
  50 <--x 26
  46 <--x 27
  47 <--x 27
  48 <--x 27
  49 <--x 28
  50 <--x 28
  54 <--x 28
  48 <--x 29
  51 <--x 29
  52 <--x 29
  52 <--x 30
  53 <--x 30
  54 <--x 30
  35 <--x 32
  37 <--x 32
  39 <--x 32
  41 <--x 32
  43 <--x 32
  45 <--x 34
  47 <--x 34
  49 <--x 34
  51 <--x 34
  53 <--x 34
```
