```mermaid
flowchart LR
  subgraph path5 [Path]
    5["Path<br>[585, 620, 0]"]
    9["Segment<br>[626, 649, 0]"]
    10["Segment<br>[655, 681, 0]"]
    11["Segment<br>[687, 711, 0]"]
    12["Segment<br>[717, 724, 0]"]
    32[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[859, 913, 0]"]
    13["Segment<br>[921, 962, 0]"]
    14["Segment<br>[970, 1002, 0]"]
    15["Segment<br>[1010, 1051, 0]"]
    16["Segment<br>[1059, 1084, 0]"]
    17["Segment<br>[1092, 1134, 0]"]
    18["Segment<br>[1142, 1175, 0]"]
    19["Segment<br>[1183, 1225, 0]"]
    20["Segment<br>[1233, 1240, 0]"]
    31[Solid2d]
  end
  subgraph path7 [Path]
    7["Path<br>[1553, 1596, 0]"]
    21["Segment<br>[1602, 1635, 0]"]
    22["Segment<br>[1641, 1683, 0]"]
    23["Segment<br>[1689, 1733, 0]"]
    24["Segment<br>[1739, 1746, 0]"]
    29[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[1881, 1923, 0]"]
    25["Segment<br>[1929, 1963, 0]"]
    26["Segment<br>[1969, 2012, 0]"]
    27["Segment<br>[2018, 2061, 0]"]
    28["Segment<br>[2067, 2074, 0]"]
    30[Solid2d]
  end
  1["Plane<br>[562, 579, 0]"]
  2["Plane<br>[834, 851, 0]"]
  3["Plane<br>[1530, 1547, 0]"]
  4["Plane<br>[1858, 1875, 0]"]
  33["Sweep Extrusion<br>[730, 753, 0]"]
  34["Sweep Extrusion<br>[1248, 1271, 0]"]
  35["Sweep Extrusion<br>[1752, 1775, 0]"]
  36["Sweep Extrusion<br>[2080, 2103, 0]"]
  37[Wall]
  38[Wall]
  39[Wall]
  40[Wall]
  41[Wall]
  42[Wall]
  43[Wall]
  44[Wall]
  45[Wall]
  46[Wall]
  47[Wall]
  48[Wall]
  49[Wall]
  50[Wall]
  51[Wall]
  52[Wall]
  53[Wall]
  54[Wall]
  55[Wall]
  56[Wall]
  57["Cap Start"]
  58["Cap End"]
  59["Cap Start"]
  60["Cap End"]
  61["Cap Start"]
  62["Cap End"]
  63["Cap Start"]
  64["Cap End"]
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
  83["SweepEdge Opposite"]
  84["SweepEdge Adjacent"]
  85["SweepEdge Opposite"]
  86["SweepEdge Adjacent"]
  87["SweepEdge Opposite"]
  88["SweepEdge Adjacent"]
  89["SweepEdge Opposite"]
  90["SweepEdge Adjacent"]
  91["SweepEdge Opposite"]
  92["SweepEdge Adjacent"]
  93["SweepEdge Opposite"]
  94["SweepEdge Adjacent"]
  95["SweepEdge Opposite"]
  96["SweepEdge Adjacent"]
  97["SweepEdge Opposite"]
  98["SweepEdge Adjacent"]
  99["SweepEdge Opposite"]
  100["SweepEdge Adjacent"]
  101["SweepEdge Opposite"]
  102["SweepEdge Adjacent"]
  103["SweepEdge Opposite"]
  104["SweepEdge Adjacent"]
  1 --- 5
  2 --- 6
  3 --- 7
  4 --- 8
  5 --- 9
  5 --- 10
  5 --- 11
  5 --- 12
  5 --- 32
  5 ---- 33
  6 --- 13
  6 --- 14
  6 --- 15
  6 --- 16
  6 --- 17
  6 --- 18
  6 --- 19
  6 --- 20
  6 --- 31
  6 ---- 34
  7 --- 21
  7 --- 22
  7 --- 23
  7 --- 24
  7 --- 29
  7 ---- 35
  8 --- 25
  8 --- 26
  8 --- 27
  8 --- 28
  8 --- 30
  8 ---- 36
  9 --- 40
  9 x--> 57
  9 --- 71
  9 --- 72
  10 --- 38
  10 x--> 57
  10 --- 67
  10 --- 68
  11 --- 37
  11 x--> 57
  11 --- 65
  11 --- 66
  12 --- 39
  12 x--> 57
  12 --- 69
  12 --- 70
  13 --- 53
  13 x--> 63
  13 --- 97
  13 --- 98
  14 --- 54
  14 x--> 63
  14 --- 99
  14 --- 100
  15 --- 51
  15 x--> 63
  15 --- 93
  15 --- 94
  16 --- 50
  16 x--> 63
  16 --- 91
  16 --- 92
  17 --- 52
  17 x--> 63
  17 --- 95
  17 --- 96
  18 --- 55
  18 x--> 63
  18 --- 101
  18 --- 102
  19 --- 56
  19 x--> 63
  19 --- 103
  19 --- 104
  20 --- 49
  20 x--> 63
  20 --- 89
  20 --- 90
  21 --- 43
  21 x--> 59
  21 --- 77
  21 --- 78
  22 --- 41
  22 x--> 59
  22 --- 73
  22 --- 74
  23 --- 42
  23 x--> 59
  23 --- 75
  23 --- 76
  24 --- 44
  24 x--> 59
  24 --- 79
  24 --- 80
  25 --- 46
  25 x--> 61
  25 --- 83
  25 --- 84
  26 --- 47
  26 x--> 61
  26 --- 85
  26 --- 86
  27 --- 45
  27 x--> 61
  27 --- 81
  27 --- 82
  28 --- 48
  28 x--> 61
  28 --- 87
  28 --- 88
  33 --- 37
  33 --- 38
  33 --- 39
  33 --- 40
  33 --- 57
  33 --- 58
  33 --- 65
  33 --- 66
  33 --- 67
  33 --- 68
  33 --- 69
  33 --- 70
  33 --- 71
  33 --- 72
  34 --- 49
  34 --- 50
  34 --- 51
  34 --- 52
  34 --- 53
  34 --- 54
  34 --- 55
  34 --- 56
  34 --- 63
  34 --- 64
  34 --- 89
  34 --- 90
  34 --- 91
  34 --- 92
  34 --- 93
  34 --- 94
  34 --- 95
  34 --- 96
  34 --- 97
  34 --- 98
  34 --- 99
  34 --- 100
  34 --- 101
  34 --- 102
  34 --- 103
  34 --- 104
  35 --- 41
  35 --- 42
  35 --- 43
  35 --- 44
  35 --- 59
  35 --- 60
  35 --- 73
  35 --- 74
  35 --- 75
  35 --- 76
  35 --- 77
  35 --- 78
  35 --- 79
  35 --- 80
  36 --- 45
  36 --- 46
  36 --- 47
  36 --- 48
  36 --- 61
  36 --- 62
  36 --- 81
  36 --- 82
  36 --- 83
  36 --- 84
  36 --- 85
  36 --- 86
  36 --- 87
  36 --- 88
  65 <--x 37
  66 <--x 37
  68 <--x 37
  67 <--x 38
  68 <--x 38
  72 <--x 38
  66 <--x 39
  69 <--x 39
  70 <--x 39
  70 <--x 40
  71 <--x 40
  72 <--x 40
  73 <--x 41
  74 <--x 41
  78 <--x 41
  74 <--x 42
  75 <--x 42
  76 <--x 42
  77 <--x 43
  78 <--x 43
  80 <--x 43
  76 <--x 44
  79 <--x 44
  80 <--x 44
  81 <--x 45
  82 <--x 45
  86 <--x 45
  83 <--x 46
  84 <--x 46
  88 <--x 46
  84 <--x 47
  85 <--x 47
  86 <--x 47
  82 <--x 48
  87 <--x 48
  88 <--x 48
  89 <--x 49
  90 <--x 49
  104 <--x 49
  91 <--x 50
  92 <--x 50
  94 <--x 50
  93 <--x 51
  94 <--x 51
  100 <--x 51
  92 <--x 52
  95 <--x 52
  96 <--x 52
  90 <--x 53
  97 <--x 53
  98 <--x 53
  98 <--x 54
  99 <--x 54
  100 <--x 54
  96 <--x 55
  101 <--x 55
  102 <--x 55
  102 <--x 56
  103 <--x 56
  104 <--x 56
  65 <--x 58
  67 <--x 58
  69 <--x 58
  71 <--x 58
  73 <--x 60
  75 <--x 60
  77 <--x 60
  79 <--x 60
  81 <--x 62
  83 <--x 62
  85 <--x 62
  87 <--x 62
  89 <--x 64
  91 <--x 64
  93 <--x 64
  95 <--x 64
  97 <--x 64
  99 <--x 64
  101 <--x 64
  103 <--x 64
```
