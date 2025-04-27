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
  subgraph path15 [Path]
    15["Path<br>[980, 1036, 0]"]
    16["Segment<br>[1042, 1101, 0]"]
    17["Segment<br>[1107, 1114, 0]"]
    18[Solid2d]
  end
  subgraph path24 [Path]
    24["Path<br>[1484, 1617, 0]"]
    25["Segment<br>[1623, 1683, 0]"]
    26["Segment<br>[1689, 1720, 0]"]
    27["Segment<br>[1726, 1754, 0]"]
    28["Segment<br>[1760, 1767, 0]"]
    29[Solid2d]
  end
  subgraph path40 [Path]
    40["Path<br>[2101, 2243, 0]"]
    41["Segment<br>[2101, 2243, 0]"]
    42[Solid2d]
  end
  subgraph path50 [Path]
    50["Path<br>[2637, 2690, 0]"]
    51["Segment<br>[2637, 2690, 0]"]
    52[Solid2d]
  end
  subgraph path53 [Path]
    53["Path<br>[2714, 2788, 0]"]
    54["Segment<br>[2714, 2788, 0]"]
    55[Solid2d]
  end
  1["Plane<br>[610, 657, 0]"]
  8["Sweep Extrusion<br>[848, 900, 0]"]
  9[Wall]
  10["Cap Start"]
  11["Cap End"]
  12["SweepEdge Opposite"]
  13["SweepEdge Adjacent"]
  14["Plane<br>[957, 974, 0]"]
  19["Sweep Revolve<br>[1196, 1226, 0]"]
  20[Wall]
  21[Wall]
  22["SweepEdge Adjacent"]
  23["Plane<br>[1461, 1478, 0]"]
  30["Sweep Revolve<br>[1809, 1839, 0]"]
  31[Wall]
  32[Wall]
  33[Wall]
  34[Wall]
  35["SweepEdge Adjacent"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Adjacent"]
  39["Plane<br>[2078, 2095, 0]"]
  43["Sweep Revolve<br>[2286, 2337, 0]"]
  44[Wall]
  45["Cap Start"]
  46["Cap End"]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["Plane<br>[2583, 2630, 0]"]
  56["Sweep Extrusion<br>[2805, 2858, 0]"]
  57[Wall]
  58["Cap Start"]
  59["Cap End"]
  60["SweepEdge Opposite"]
  61["SweepEdge Adjacent"]
  62["StartSketchOnPlane<br>[596, 658, 0]"]
  63["StartSketchOnPlane<br>[2569, 2631, 0]"]
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
