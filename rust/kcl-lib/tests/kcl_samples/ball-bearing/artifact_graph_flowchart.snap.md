```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[664, 726, 0]"]
    3["Segment<br>[664, 726, 0]"]
    4[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[737, 783, 0]"]
    6["Segment<br>[737, 783, 0]"]
    7[Solid2d]
  end
  subgraph path13 [Path]
    13["Path<br>[970, 1026, 0]"]
    14["Segment<br>[1032, 1091, 0]"]
    15["Segment<br>[1097, 1104, 0]"]
    16[Solid2d]
  end
  subgraph path21 [Path]
    21["Path<br>[1474, 1607, 0]"]
    22["Segment<br>[1613, 1673, 0]"]
    23["Segment<br>[1679, 1710, 0]"]
    24["Segment<br>[1716, 1744, 0]"]
    25["Segment<br>[1750, 1757, 0]"]
    26[Solid2d]
  end
  subgraph path33 [Path]
    33["Path<br>[2091, 2233, 0]"]
    34["Segment<br>[2091, 2233, 0]"]
    35[Solid2d]
  end
  subgraph path41 [Path]
    41["Path<br>[2627, 2680, 0]"]
    42["Segment<br>[2627, 2680, 0]"]
    43[Solid2d]
  end
  subgraph path44 [Path]
    44["Path<br>[2691, 2765, 0]"]
    45["Segment<br>[2691, 2765, 0]"]
    46[Solid2d]
  end
  1["Plane<br>[610, 657, 0]"]
  8["Sweep Extrusion<br>[838, 890, 0]"]
  9[Wall]
  10["Cap Start"]
  11["Cap End"]
  12["Plane<br>[947, 964, 0]"]
  17["Sweep Revolve<br>[1186, 1216, 0]"]
  18[Wall]
  19[Wall]
  20["Plane<br>[1451, 1468, 0]"]
  27["Sweep Revolve<br>[1799, 1829, 0]"]
  28[Wall]
  29[Wall]
  30[Wall]
  31[Wall]
  32["Plane<br>[2068, 2085, 0]"]
  36["Sweep Revolve<br>[2276, 2327, 0]"]
  37[Wall]
  38["Cap Start"]
  39["Cap End"]
  40["Plane<br>[2573, 2620, 0]"]
  47["Sweep Extrusion<br>[2785, 2838, 0]"]
  48[Wall]
  49["Cap Start"]
  50["Cap End"]
  51["StartSketchOnPlane<br>[596, 658, 0]"]
  52["StartSketchOnPlane<br>[2559, 2621, 0]"]
  1 --- 2
  1 --- 5
  2 --- 3
  2 ---- 8
  2 --- 4
  3 --- 9
  3 x--> 10
  5 --- 6
  5 --- 7
  8 --- 9
  8 --- 10
  8 --- 11
  12 --- 13
  13 --- 14
  13 --- 15
  13 ---- 17
  13 --- 16
  14 --- 18
  15 --- 19
  17 --- 18
  17 --- 19
  17 <--x 15
  20 --- 21
  21 --- 22
  21 --- 23
  21 --- 24
  21 --- 25
  21 ---- 27
  21 --- 26
  22 --- 28
  23 --- 29
  24 --- 30
  25 --- 31
  27 --- 28
  27 --- 29
  27 --- 30
  27 --- 31
  27 <--x 23
  27 <--x 24
  27 <--x 25
  32 --- 33
  33 --- 34
  33 ---- 36
  33 --- 35
  34 --- 37
  34 x--> 38
  36 --- 37
  36 --- 38
  36 --- 39
  40 --- 41
  40 --- 44
  41 --- 42
  41 ---- 47
  41 --- 43
  42 --- 48
  42 x--> 49
  44 --- 45
  44 --- 46
  47 --- 48
  47 --- 49
  47 --- 50
  1 <--x 51
  40 <--x 52
```
