```mermaid
flowchart LR
  subgraph path4 [Path]
    4["Path<br>[412, 437, 0]"]
    7["Segment<br>[443, 484, 0]"]
    8["Segment<br>[490, 536, 0]"]
    9["Segment<br>[542, 567, 0]"]
    10["Segment<br>[573, 604, 0]"]
    11["Segment<br>[610, 639, 0]"]
    12["Segment<br>[645, 691, 0]"]
    13["Segment<br>[697, 732, 0]"]
    14["Segment<br>[738, 745, 0]"]
    24[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[810, 851, 0]"]
    15["Segment<br>[857, 900, 0]"]
    16["Segment<br>[906, 1006, 0]"]
    17["Segment<br>[1012, 1041, 0]"]
    18["Segment<br>[1047, 1054, 0]"]
    25[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[1384, 1433, 0]"]
    19["Segment<br>[1439, 1479, 0]"]
    20["Segment<br>[1485, 1585, 0]"]
    21["Segment<br>[1591, 1628, 0]"]
    22["Segment<br>[1634, 1641, 0]"]
    23[Solid2d]
  end
  1["Plane<br>[389, 406, 0]"]
  2["Plane<br>[787, 804, 0]"]
  3["Plane<br>[1361, 1378, 0]"]
  26["Sweep Extrusion<br>[751, 775, 0]"]
  27["Sweep Extrusion<br>[1060, 1098, 0]"]
  28["Sweep Extrusion<br>[1647, 1685, 0]"]
  29[Wall]
  30[Wall]
  31[Wall]
  32[Wall]
  33[Wall]
  34[Wall]
  35[Wall]
  36[Wall]
  37[Wall]
  38[Wall]
  39[Wall]
  40[Wall]
  41[Wall]
  42[Wall]
  43[Wall]
  44[Wall]
  45["Cap Start"]
  46["Cap Start"]
  47["Cap Start"]
  48["Cap End"]
  49["Cap End"]
  50["Cap End"]
  51["SweepEdge Opposite"]
  52["SweepEdge Adjacent"]
  53["SweepEdge Opposite"]
  54["SweepEdge Adjacent"]
  55["SweepEdge Opposite"]
  56["SweepEdge Adjacent"]
  57["SweepEdge Opposite"]
  58["SweepEdge Adjacent"]
  59["SweepEdge Opposite"]
  60["SweepEdge Adjacent"]
  61["SweepEdge Opposite"]
  62["SweepEdge Adjacent"]
  63["SweepEdge Opposite"]
  64["SweepEdge Adjacent"]
  65["SweepEdge Opposite"]
  66["SweepEdge Adjacent"]
  67["SweepEdge Opposite"]
  68["SweepEdge Adjacent"]
  69["SweepEdge Opposite"]
  70["SweepEdge Adjacent"]
  71["SweepEdge Opposite"]
  72["SweepEdge Adjacent"]
  73["SweepEdge Opposite"]
  74["SweepEdge Adjacent"]
  75["SweepEdge Opposite"]
  76["SweepEdge Adjacent"]
  77["SweepEdge Opposite"]
  78["SweepEdge Adjacent"]
  79["SweepEdge Opposite"]
  80["SweepEdge Adjacent"]
  81["SweepEdge Opposite"]
  82["SweepEdge Adjacent"]
  83["EdgeCut Fillet<br>[1104, 1185, 0]"]
  84["EdgeCut Fillet<br>[1691, 1773, 0]"]
  1 --- 4
  2 --- 5
  3 --- 6
  4 --- 7
  4 --- 8
  4 --- 9
  4 --- 10
  4 --- 11
  4 --- 12
  4 --- 13
  4 --- 14
  4 --- 24
  4 ---- 26
  5 --- 15
  5 --- 16
  5 --- 17
  5 --- 18
  5 --- 25
  5 ---- 27
  6 --- 19
  6 --- 20
  6 --- 21
  6 --- 22
  6 --- 23
  6 ---- 28
  7 --- 43
  7 x--> 50
  7 --- 79
  7 --- 80
  8 --- 40
  8 x--> 50
  8 --- 73
  8 --- 74
  9 --- 39
  9 x--> 50
  9 --- 71
  9 --- 72
  10 --- 41
  10 x--> 50
  10 --- 75
  10 --- 76
  11 --- 38
  11 x--> 50
  11 --- 69
  11 --- 70
  12 --- 37
  12 x--> 50
  12 --- 67
  12 --- 68
  13 --- 42
  13 x--> 50
  13 --- 77
  13 --- 78
  14 --- 44
  14 x--> 50
  14 --- 81
  14 --- 82
  15 --- 35
  15 x--> 49
  15 --- 63
  15 --- 64
  16 --- 34
  16 x--> 49
  16 --- 61
  16 --- 62
  17 --- 36
  17 x--> 49
  17 --- 65
  17 --- 66
  18 --- 33
  18 x--> 49
  18 --- 59
  18 --- 60
  19 --- 31
  19 x--> 48
  19 --- 55
  19 --- 56
  20 --- 32
  20 x--> 48
  20 --- 57
  20 --- 58
  21 --- 30
  21 x--> 48
  21 --- 53
  21 --- 54
  22 --- 29
  22 x--> 48
  22 --- 51
  22 --- 52
  26 --- 37
  26 --- 38
  26 --- 39
  26 --- 40
  26 --- 41
  26 --- 42
  26 --- 43
  26 --- 44
  26 --- 47
  26 --- 50
  26 --- 67
  26 --- 68
  26 --- 69
  26 --- 70
  26 --- 71
  26 --- 72
  26 --- 73
  26 --- 74
  26 --- 75
  26 --- 76
  26 --- 77
  26 --- 78
  26 --- 79
  26 --- 80
  26 --- 81
  26 --- 82
  27 --- 33
  27 --- 34
  27 --- 35
  27 --- 36
  27 --- 46
  27 --- 49
  27 --- 59
  27 --- 60
  27 --- 61
  27 --- 62
  27 --- 63
  27 --- 64
  27 --- 65
  27 --- 66
  28 --- 29
  28 --- 30
  28 --- 31
  28 --- 32
  28 --- 45
  28 --- 48
  28 --- 51
  28 --- 52
  28 --- 53
  28 --- 54
  28 --- 55
  28 --- 56
  28 --- 57
  28 --- 58
  51 <--x 29
  52 <--x 29
  54 <--x 29
  53 <--x 30
  54 <--x 30
  58 <--x 30
  52 <--x 31
  55 <--x 31
  56 <--x 31
  56 <--x 32
  57 <--x 32
  58 <--x 32
  59 <--x 33
  60 <--x 33
  66 <--x 33
  61 <--x 34
  62 <--x 34
  64 <--x 34
  60 <--x 35
  63 <--x 35
  64 <--x 35
  62 <--x 36
  65 <--x 36
  66 <--x 36
  67 <--x 37
  68 <--x 37
  70 <--x 37
  69 <--x 38
  70 <--x 38
  76 <--x 38
  71 <--x 39
  72 <--x 39
  74 <--x 39
  73 <--x 40
  74 <--x 40
  80 <--x 40
  72 <--x 41
  75 <--x 41
  76 <--x 41
  68 <--x 42
  77 <--x 42
  78 <--x 42
  79 <--x 43
  80 <--x 43
  82 <--x 43
  78 <--x 44
  81 <--x 44
  82 <--x 44
  51 <--x 45
  53 <--x 45
  55 <--x 45
  57 <--x 45
  59 <--x 46
  61 <--x 46
  63 <--x 46
  65 <--x 46
  67 <--x 47
  69 <--x 47
  71 <--x 47
  73 <--x 47
  75 <--x 47
  77 <--x 47
  79 <--x 47
  81 <--x 47
  58 <--x 84
  62 <--x 83
```
