```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[664, 726, 0]"]
    3["Segment<br>[664, 726, 0]"]
    4[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[750, 796, 0]"]
    6["Segment<br>[750, 796, 0]"]
    7[Solid2d]
  end
<<<<<<< HEAD
  subgraph path13 [Path]
    13["Path<br>[980, 1036, 0]"]
    14["Segment<br>[1042, 1101, 0]"]
    15["Segment<br>[1107, 1114, 0]"]
    16[Solid2d]
  end
  subgraph path21 [Path]
    21["Path<br>[1484, 1617, 0]"]
    22["Segment<br>[1623, 1683, 0]"]
    23["Segment<br>[1689, 1720, 0]"]
    24["Segment<br>[1726, 1754, 0]"]
    25["Segment<br>[1760, 1767, 0]"]
    26[Solid2d]
  end
  subgraph path33 [Path]
    33["Path<br>[2101, 2243, 0]"]
    34["Segment<br>[2101, 2243, 0]"]
    35[Solid2d]
  end
  subgraph path41 [Path]
    41["Path<br>[2637, 2690, 0]"]
    42["Segment<br>[2637, 2690, 0]"]
    43[Solid2d]
  end
  subgraph path44 [Path]
    44["Path<br>[2714, 2788, 0]"]
    45["Segment<br>[2714, 2788, 0]"]
    46[Solid2d]
=======
  subgraph path15 [Path]
    15["Path<br>[970, 1026, 0]"]
    16["Segment<br>[1032, 1091, 0]"]
    17["Segment<br>[1097, 1104, 0]"]
    18[Solid2d]
  end
  subgraph path24 [Path]
    24["Path<br>[1474, 1607, 0]"]
    25["Segment<br>[1613, 1673, 0]"]
    26["Segment<br>[1679, 1710, 0]"]
    27["Segment<br>[1716, 1744, 0]"]
    28["Segment<br>[1750, 1757, 0]"]
    29[Solid2d]
  end
  subgraph path40 [Path]
    40["Path<br>[2091, 2233, 0]"]
    41["Segment<br>[2091, 2233, 0]"]
    42[Solid2d]
  end
  subgraph path50 [Path]
    50["Path<br>[2627, 2680, 0]"]
    51["Segment<br>[2627, 2680, 0]"]
    52[Solid2d]
  end
  subgraph path53 [Path]
    53["Path<br>[2691, 2765, 0]"]
    54["Segment<br>[2691, 2765, 0]"]
    55[Solid2d]
>>>>>>> d43b13987 (artifact graph things)
  end
  1["Plane<br>[610, 657, 0]"]
  8["Sweep Extrusion<br>[848, 900, 0]"]
  9[Wall]
  10["Cap Start"]
  11["Cap End"]
<<<<<<< HEAD
  12["Plane<br>[957, 974, 0]"]
  17["Sweep Revolve<br>[1196, 1226, 0]"]
  18[Wall]
  19[Wall]
  20["Plane<br>[1461, 1478, 0]"]
  27["Sweep Revolve<br>[1809, 1839, 0]"]
  28[Wall]
  29[Wall]
  30[Wall]
  31[Wall]
  32["Plane<br>[2078, 2095, 0]"]
  36["Sweep Revolve<br>[2286, 2337, 0]"]
  37[Wall]
  38["Cap Start"]
  39["Cap End"]
  40["Plane<br>[2583, 2630, 0]"]
  47["Sweep Extrusion<br>[2805, 2858, 0]"]
  48[Wall]
  49["Cap Start"]
  50["Cap End"]
  51["StartSketchOnPlane<br>[596, 658, 0]"]
  52["StartSketchOnPlane<br>[2569, 2631, 0]"]
=======
  12["SweepEdge Opposite"]
  13["SweepEdge Adjacent"]
  14["Plane<br>[947, 964, 0]"]
  19["Sweep Revolve<br>[1186, 1216, 0]"]
  20[Wall]
  21[Wall]
  22["SweepEdge Adjacent"]
  23["Plane<br>[1451, 1468, 0]"]
  30["Sweep Revolve<br>[1799, 1829, 0]"]
  31[Wall]
  32[Wall]
  33[Wall]
  34[Wall]
  35["SweepEdge Adjacent"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Adjacent"]
  39["Plane<br>[2068, 2085, 0]"]
  43["Sweep Revolve<br>[2276, 2327, 0]"]
  44[Wall]
  45["Cap Start"]
  46["Cap End"]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["Plane<br>[2573, 2620, 0]"]
  56["Sweep Extrusion<br>[2785, 2838, 0]"]
  57[Wall]
  58["Cap Start"]
  59["Cap End"]
  60["SweepEdge Opposite"]
  61["SweepEdge Adjacent"]
  62["StartSketchOnPlane<br>[596, 658, 0]"]
  63["StartSketchOnPlane<br>[2559, 2621, 0]"]
>>>>>>> d43b13987 (artifact graph things)
  1 --- 2
  1 --- 5
  2 --- 3
  2 ---- 8
  2 --- 4
  3 --- 9
  3 --- 12
  3 --- 13
  3 x--> 10
  5 --- 6
  5 --- 7
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  12 <--x 9
  12 <--x 11
  13 <--x 9
  14 --- 15
  15 --- 16
  15 --- 17
  15 ---- 19
  15 --- 18
  16 --- 20
  16 x--> 22
  17 --- 21
  17 --- 22
  19 --- 20
  19 --- 21
  19 <--x 16
  19 --- 22
  19 <--x 17
  22 <--x 20
  22 <--x 21
  23 --- 24
  24 --- 25
  24 --- 26
  24 --- 27
  24 --- 28
  24 ---- 30
  24 --- 29
  25 --- 31
  25 --- 35
  26 --- 32
  26 --- 36
  27 --- 33
  27 --- 37
  28 --- 34
  28 --- 38
  30 --- 31
  30 --- 32
  30 --- 33
  30 --- 34
  30 <--x 25
  30 --- 35
  30 <--x 26
  30 --- 36
  30 <--x 27
  30 --- 37
  30 <--x 28
  30 --- 38
  35 <--x 31
  35 <--x 32
  36 <--x 32
  36 <--x 33
  37 <--x 33
  37 <--x 34
  38 <--x 34
  38 <--x 31
  39 --- 40
  40 --- 41
  40 ---- 43
  40 --- 42
  41 --- 44
  41 --- 47
  41 --- 48
  41 x--> 45
  43 --- 44
  43 --- 45
  43 --- 46
  43 --- 47
  43 --- 48
  47 <--x 44
  47 <--x 46
  48 <--x 44
  49 --- 50
  49 --- 53
  50 --- 51
  50 ---- 56
  50 --- 52
  51 --- 57
  51 --- 60
  51 --- 61
  51 x--> 58
  53 --- 54
  53 --- 55
  56 --- 57
  56 --- 58
  56 --- 59
  56 --- 60
  56 --- 61
  60 <--x 57
  60 <--x 59
  61 <--x 57
  1 <--x 62
  49 <--x 63
```
