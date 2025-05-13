```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[88, 135, 0]"]
    5["Segment<br>[141, 163, 0]"]
    6["Segment<br>[169, 253, 0]"]
    7["Segment<br>[259, 292, 0]"]
    8["Segment<br>[298, 393, 0]"]
    9["Segment<br>[399, 430, 0]"]
    10["Segment<br>[436, 522, 0]"]
    11["Segment<br>[528, 550, 0]"]
    12["Segment<br>[556, 578, 0]"]
    13["Segment<br>[584, 607, 0]"]
    14["Segment<br>[613, 700, 0]"]
    15["Segment<br>[706, 739, 0]"]
    16["Segment<br>[745, 840, 0]"]
    17["Segment<br>[846, 879, 0]"]
    18["Segment<br>[885, 970, 0]"]
    19["Segment<br>[976, 999, 0]"]
    20["Segment<br>[1005, 1026, 0]"]
    21["Segment<br>[1032, 1039, 0]"]
    23[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[1286, 1346, 0]"]
    22["Segment<br>[1286, 1346, 0]"]
    24[Solid2d]
  end
  1["Plane<br>[47, 64, 0]"]
  2["Plane<br>[1239, 1262, 0]"]
  25["Sweep Extrusion<br>[1054, 1123, 0]"]
  26["Sweep Extrusion<br>[1364, 1406, 0]"]
  27["CompositeSolid Subtract<br>[1417, 1460, 0]"]
  28[Wall]
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
  47["Cap End"]
  48["Cap End"]
  49["SweepEdge Opposite"]
  50["SweepEdge Opposite"]
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
  66["SweepEdge Adjacent"]
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
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 9
  3 --- 10
  3 --- 11
  3 --- 12
  3 --- 13
  3 --- 14
  3 --- 15
  3 --- 16
  3 --- 17
  3 --- 18
  3 --- 19
  3 --- 20
  3 --- 21
  3 --- 23
  3 ---- 25
  3 --- 27
  4 --- 22
  4 --- 24
  4 ---- 26
  4 --- 27
  5 --- 41
  5 x--> 46
  5 --- 57
  5 --- 69
  6 --- 36
  6 x--> 46
  6 --- 52
  6 --- 81
  7 --- 35
  7 x--> 46
  7 --- 54
  7 --- 74
  8 --- 37
  8 x--> 46
  8 --- 56
  8 --- 78
  9 --- 33
  9 x--> 46
  9 --- 53
  9 --- 72
  10 --- 32
  10 x--> 46
  10 --- 65
  10 --- 68
  11 --- 40
  11 x--> 46
  11 --- 50
  11 --- 76
  12 --- 43
  12 x--> 46
  12 --- 61
  12 --- 67
  13 --- 42
  13 x--> 46
  13 --- 60
  13 --- 80
  14 --- 30
  14 x--> 46
  14 --- 62
  14 --- 82
  15 --- 31
  15 x--> 46
  15 --- 51
  15 --- 73
  16 --- 44
  16 x--> 46
  16 --- 63
  16 --- 77
  17 --- 38
  17 x--> 46
  17 --- 55
  17 --- 79
  18 --- 34
  18 x--> 46
  18 --- 59
  18 --- 71
  19 --- 29
  19 x--> 46
  19 --- 64
  19 --- 70
  20 --- 39
  20 x--> 46
  20 --- 58
  20 --- 75
  22 --- 28
  22 x--> 45
  22 --- 49
  22 --- 66
  25 --- 29
  25 --- 30
  25 --- 31
  25 --- 32
  25 --- 33
  25 --- 34
  25 --- 35
  25 --- 36
  25 --- 37
  25 --- 38
  25 --- 39
  25 --- 40
  25 --- 41
  25 --- 42
  25 --- 43
  25 --- 44
  25 --- 46
  25 --- 48
  25 --- 50
  25 --- 51
  25 --- 52
  25 --- 53
  25 --- 54
  25 --- 55
  25 --- 56
  25 --- 57
  25 --- 58
  25 --- 59
  25 --- 60
  25 --- 61
  25 --- 62
  25 --- 63
  25 --- 64
  25 --- 65
  25 --- 67
  25 --- 68
  25 --- 69
  25 --- 70
  25 --- 71
  25 --- 72
  25 --- 73
  25 --- 74
  25 --- 75
  25 --- 76
  25 --- 77
  25 --- 78
  25 --- 79
  25 --- 80
  25 --- 81
  25 --- 82
  26 --- 28
  26 --- 45
  26 --- 47
  26 --- 49
  26 --- 66
  49 <--x 28
  66 <--x 28
  64 <--x 29
  70 <--x 29
  71 <--x 29
  62 <--x 30
  80 <--x 30
  82 <--x 30
  51 <--x 31
  73 <--x 31
  82 <--x 31
  65 <--x 32
  68 <--x 32
  72 <--x 32
  53 <--x 33
  72 <--x 33
  78 <--x 33
  59 <--x 34
  71 <--x 34
  79 <--x 34
  54 <--x 35
  74 <--x 35
  81 <--x 35
  52 <--x 36
  69 <--x 36
  81 <--x 36
  56 <--x 37
  74 <--x 37
  78 <--x 37
  55 <--x 38
  77 <--x 38
  79 <--x 38
  58 <--x 39
  70 <--x 39
  75 <--x 39
  50 <--x 40
  68 <--x 40
  76 <--x 40
  57 <--x 41
  69 <--x 41
  75 <--x 41
  60 <--x 42
  67 <--x 42
  80 <--x 42
  61 <--x 43
  67 <--x 43
  76 <--x 43
  63 <--x 44
  73 <--x 44
  77 <--x 44
  49 <--x 47
  50 <--x 48
  51 <--x 48
  52 <--x 48
  53 <--x 48
  54 <--x 48
  55 <--x 48
  56 <--x 48
  57 <--x 48
  58 <--x 48
  59 <--x 48
  60 <--x 48
  61 <--x 48
  62 <--x 48
  63 <--x 48
  64 <--x 48
  65 <--x 48
```
