```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[730, 755, 0]"]
    3["Segment<br>[761, 798, 0]"]
    4["Segment<br>[804, 844, 0]"]
    5["Segment<br>[850, 887, 0]"]
    6["Segment<br>[893, 929, 0]"]
    7["Segment<br>[935, 973, 0]"]
    8["Segment<br>[979, 1019, 0]"]
    9["Segment<br>[1025, 1063, 0]"]
    10["Segment<br>[1069, 1122, 0]"]
    11["Segment<br>[1128, 1165, 0]"]
    12["Segment<br>[1171, 1225, 0]"]
    13["Segment<br>[1231, 1270, 0]"]
    14["Segment<br>[1276, 1293, 0]"]
    15[Solid2d]
  end
  subgraph path56 [Path]
    56["Path<br>[2119, 2144, 0]"]
    57["Segment<br>[2150, 2175, 0]"]
    58["Segment<br>[2181, 2221, 0]"]
    59["Segment<br>[2227, 2265, 0]"]
    60["Segment<br>[2271, 2278, 0]"]
    61[Solid2d]
  end
  subgraph path62 [Path]
    62["Path<br>[2289, 2360, 0]"]
    63["Segment<br>[2289, 2360, 0]"]
    64[Solid2d]
  end
  subgraph path65 [Path]
    65["Path<br>[2375, 2446, 0]"]
    66["Segment<br>[2375, 2446, 0]"]
    67[Solid2d]
  end
  subgraph path84 [Path]
    84["Path<br>[2655, 2681, 0]"]
    85["Segment<br>[2687, 2712, 0]"]
    86["Segment<br>[2718, 2759, 0]"]
    87["Segment<br>[2765, 2803, 0]"]
    88["Segment<br>[2809, 2816, 0]"]
    89[Solid2d]
  end
  subgraph path90 [Path]
    90["Path<br>[2827, 2899, 0]"]
    91["Segment<br>[2827, 2899, 0]"]
    92[Solid2d]
  end
  subgraph path93 [Path]
    93["Path<br>[2914, 2986, 0]"]
    94["Segment<br>[2914, 2986, 0]"]
    95[Solid2d]
  end
  1["Plane<br>[704, 724, 0]"]
  16["Sweep Extrusion<br>[1299, 1325, 0]"]
  17[Wall]
  18[Wall]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25[Wall]
  26[Wall]
  27[Wall]
  28[Wall]
  29["Cap Start"]
  30["Cap End"]
  31["SweepEdge Opposite"]
  32["SweepEdge Adjacent"]
  33["SweepEdge Opposite"]
  34["SweepEdge Adjacent"]
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
  55["Plane<br>[2094, 2113, 0]"]
  68["Sweep Extrusion<br>[2456, 2483, 0]"]
  69[Wall]
  70[Wall]
  71[Wall]
  72[Wall]
  73["Cap Start"]
  74["Cap End"]
  75["SweepEdge Opposite"]
  76["SweepEdge Adjacent"]
  77["SweepEdge Opposite"]
  78["SweepEdge Adjacent"]
  79["SweepEdge Opposite"]
  80["SweepEdge Adjacent"]
  81["SweepEdge Opposite"]
  82["SweepEdge Adjacent"]
  83["Plane<br>[2630, 2649, 0]"]
  96["Sweep Extrusion<br>[2996, 3023, 0]"]
  97[Wall]
  98[Wall]
  99[Wall]
  100[Wall]
  101["Cap Start"]
  102["Cap End"]
  103["SweepEdge Opposite"]
  104["SweepEdge Adjacent"]
  105["SweepEdge Opposite"]
  106["SweepEdge Adjacent"]
  107["SweepEdge Opposite"]
  108["SweepEdge Adjacent"]
  109["SweepEdge Opposite"]
  110["SweepEdge Adjacent"]
  111["EdgeCut Fillet<br>[1331, 1410, 0]"]
  112["EdgeCut Fillet<br>[1416, 1502, 0]"]
  113["EdgeCut Fillet<br>[1508, 1594, 0]"]
  114["EdgeCut Fillet<br>[1600, 1679, 0]"]
  115["EdgeCut Fillet<br>[1685, 1771, 0]"]
  116["EdgeCut Fillet<br>[1777, 1856, 0]"]
  117["EdgeCut Fillet<br>[1862, 1942, 0]"]
  118["EdgeCut Fillet<br>[1948, 2035, 0]"]
  119["EdgeCut Fillet<br>[2489, 2618, 0]"]
  120["EdgeCut Fillet<br>[2489, 2618, 0]"]
  121["EdgeCut Fillet<br>[3029, 3159, 0]"]
  122["EdgeCut Fillet<br>[3029, 3159, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 --- 9
  2 --- 10
  2 --- 11
  2 --- 12
  2 --- 13
  2 --- 14
  2 ---- 16
  2 --- 15
  3 --- 28
  3 --- 53
  3 --- 54
  4 --- 27
  4 --- 51
  4 --- 52
  5 --- 26
  5 --- 49
  5 --- 50
  6 --- 25
  6 --- 47
  6 --- 48
  7 --- 24
  7 --- 45
  7 --- 46
  8 --- 23
  8 --- 43
  8 --- 44
  9 --- 22
  9 --- 41
  9 --- 42
  10 --- 21
  10 --- 39
  10 --- 40
  11 --- 20
  11 --- 37
  11 --- 38
  12 --- 19
  12 --- 35
  12 --- 36
  13 --- 18
  13 --- 33
  13 --- 34
  14 --- 17
  14 --- 31
  14 --- 32
  16 --- 17
  16 --- 18
  16 --- 19
  16 --- 20
  16 --- 21
  16 --- 22
  16 --- 23
  16 --- 24
  16 --- 25
  16 --- 26
  16 --- 27
  16 --- 28
  16 --- 29
  16 --- 30
  16 --- 31
  16 --- 32
  16 --- 33
  16 --- 34
  16 --- 35
  16 --- 36
  16 --- 37
  16 --- 38
  16 --- 39
  16 --- 40
  16 --- 41
  16 --- 42
  16 --- 43
  16 --- 44
  16 --- 45
  16 --- 46
  16 --- 47
  16 --- 48
  16 --- 49
  16 --- 50
  16 --- 51
  16 --- 52
  16 --- 53
  16 --- 54
  55 --- 56
  55 --- 62
  55 --- 65
  56 --- 57
  56 --- 58
  56 --- 59
  56 --- 60
  56 ---- 68
  56 --- 61
  57 --- 72
  57 --- 81
  57 --- 82
  58 --- 71
  58 --- 79
  58 --- 80
  59 --- 70
  59 --- 77
  59 --- 78
  60 --- 69
  60 --- 75
  60 --- 76
  62 --- 63
  62 --- 64
  65 --- 66
  65 --- 67
  68 --- 69
  68 --- 70
  68 --- 71
  68 --- 72
  68 --- 73
  68 --- 74
  68 --- 75
  68 --- 76
  68 --- 77
  68 --- 78
  68 --- 79
  68 --- 80
  68 --- 81
  68 --- 82
  83 --- 84
  83 --- 90
  83 --- 93
  84 --- 85
  84 --- 86
  84 --- 87
  84 --- 88
  84 ---- 96
  84 --- 89
  85 --- 97
  85 --- 103
  85 --- 104
  86 --- 98
  86 --- 105
  86 --- 106
  87 --- 99
  87 --- 107
  87 --- 108
  88 --- 100
  88 --- 109
  88 --- 110
  90 --- 91
  90 --- 92
  93 --- 94
  93 --- 95
  96 --- 97
  96 --- 98
  96 --- 99
  96 --- 100
  96 --- 101
  96 --- 102
  96 --- 103
  96 --- 104
  96 --- 105
  96 --- 106
  96 --- 107
  96 --- 108
  96 --- 109
  96 --- 110
  52 <--x 111
  50 <--x 112
  48 <--x 113
  46 <--x 114
  40 <--x 115
  38 <--x 116
  36 <--x 117
  34 <--x 118
  80 <--x 119
  78 <--x 120
  106 <--x 121
  108 <--x 122
```
