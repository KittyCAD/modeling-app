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
  52["SweepEdge Opposite"]
  53["SweepEdge Opposite"]
  54["SweepEdge Opposite"]
  55["SweepEdge Opposite"]
  56["SweepEdge Opposite"]
  57["SweepEdge Opposite"]
  58["SweepEdge Opposite"]
  59["SweepEdge Opposite"]
  60["SweepEdge Opposite"]
  61["SweepEdge Opposite"]
  62["SweepEdge Opposite"]
  63["SweepEdge Opposite"]
  64["SweepEdge Opposite"]
  65["SweepEdge Opposite"]
  66["SweepEdge Opposite"]
  67["SweepEdge Adjacent"]
  68["SweepEdge Adjacent"]
  69["SweepEdge Adjacent"]
  70["SweepEdge Adjacent"]
  71["SweepEdge Adjacent"]
  72["SweepEdge Adjacent"]
  73["SweepEdge Adjacent"]
  74["SweepEdge Adjacent"]
  75["SweepEdge Adjacent"]
  76["SweepEdge Adjacent"]
  77["SweepEdge Adjacent"]
  78["SweepEdge Adjacent"]
  79["SweepEdge Adjacent"]
  80["SweepEdge Adjacent"]
  81["SweepEdge Adjacent"]
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
  7 --- 64
  7 --- 75
  8 --- 40
  8 x--> 50
  8 --- 60
  8 --- 78
  9 --- 39
  9 x--> 50
  9 --- 63
  9 --- 76
  10 --- 41
  10 x--> 50
  10 --- 59
  10 --- 80
  11 --- 38
  11 x--> 50
  11 --- 61
  11 --- 81
  12 --- 37
  12 x--> 50
  12 --- 66
  12 --- 82
  13 --- 42
  13 x--> 50
  13 --- 65
  13 --- 77
  14 --- 44
  14 x--> 50
  14 --- 62
  14 --- 79
  15 --- 35
  15 x--> 49
  15 --- 55
  15 --- 73
  16 --- 34
  16 x--> 49
  16 --- 58
  16 --- 72
  17 --- 36
  17 x--> 49
  17 --- 56
  17 --- 71
  18 --- 33
  18 x--> 49
  18 --- 57
  18 --- 74
  19 --- 31
  19 x--> 48
  19 --- 53
  19 --- 69
  20 --- 32
  20 x--> 48
  20 --- 52
  20 --- 68
  21 --- 30
  21 x--> 48
  21 --- 51
  21 --- 70
  22 --- 29
  22 x--> 48
  22 --- 54
  22 --- 67
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
  26 --- 59
  26 --- 60
  26 --- 61
  26 --- 62
  26 --- 63
  26 --- 64
  26 --- 65
  26 --- 66
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
  27 --- 55
  27 --- 56
  27 --- 57
  27 --- 58
  27 --- 71
  27 --- 72
  27 --- 73
  27 --- 74
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
  28 --- 67
  28 --- 68
  28 --- 69
  28 --- 70
  54 <--x 29
  67 <--x 29
  70 <--x 29
  51 <--x 30
  70 <--x 30
  53 <--x 31
  67 <--x 31
  69 <--x 31
  52 <--x 32
  69 <--x 32
  57 <--x 33
  71 <--x 33
  74 <--x 33
  58 <--x 34
  73 <--x 34
  55 <--x 35
  73 <--x 35
  74 <--x 35
  56 <--x 36
  71 <--x 36
  66 <--x 37
  81 <--x 37
  82 <--x 37
  61 <--x 38
  80 <--x 38
  81 <--x 38
  63 <--x 39
  76 <--x 39
  78 <--x 39
  60 <--x 40
  75 <--x 40
  78 <--x 40
  59 <--x 41
  76 <--x 41
  80 <--x 41
  65 <--x 42
  77 <--x 42
  82 <--x 42
  64 <--x 43
  75 <--x 43
  79 <--x 43
  62 <--x 44
  77 <--x 44
  79 <--x 44
  51 <--x 45
  52 <--x 45
  53 <--x 45
  54 <--x 45
  55 <--x 46
  56 <--x 46
  57 <--x 46
  58 <--x 46
  59 <--x 47
  60 <--x 47
  61 <--x 47
  62 <--x 47
  63 <--x 47
  64 <--x 47
  65 <--x 47
  66 <--x 47
  68 <--x 84
  72 <--x 83
```
