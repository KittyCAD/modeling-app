```mermaid
flowchart LR
  subgraph path8 [Path]
    8["Path<br>[664, 726, 0]"]
    15["Segment<br>[664, 726, 0]"]
    32[Solid2d]
  end
  subgraph path9 [Path]
    9["Path<br>[750, 796, 0]"]
    16["Segment<br>[750, 796, 0]"]
    31[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[980, 1036, 0]"]
    17["Segment<br>[1042, 1101, 0]"]
    18["Segment<br>[1107, 1114, 0]"]
    30[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[1484, 1606, 0]"]
    19["Segment<br>[1612, 1672, 0]"]
    20["Segment<br>[1678, 1709, 0]"]
    21["Segment<br>[1715, 1743, 0]"]
    22["Segment<br>[1749, 1756, 0]"]
    27[Solid2d]
  end
  subgraph path12 [Path]
    12["Path<br>[2090, 2232, 0]"]
    23["Segment<br>[2090, 2232, 0]"]
    28[Solid2d]
  end
  subgraph path13 [Path]
    13["Path<br>[2626, 2679, 0]"]
    24["Segment<br>[2626, 2679, 0]"]
    26[Solid2d]
  end
  subgraph path14 [Path]
    14["Path<br>[2703, 2777, 0]"]
    25["Segment<br>[2703, 2777, 0]"]
    29[Solid2d]
  end
  1["Plane<br>[610, 657, 0]"]
  2["Plane<br>[957, 974, 0]"]
  3["Plane<br>[1461, 1478, 0]"]
  4["Plane<br>[2067, 2084, 0]"]
  5["Plane<br>[2572, 2619, 0]"]
  6["StartSketchOnPlane<br>[2558, 2620, 0]"]
  7["StartSketchOnPlane<br>[596, 658, 0]"]
  33["Sweep Extrusion<br>[848, 900, 0]"]
  34["Sweep Revolve<br>[1196, 1226, 0]"]
  35["Sweep Revolve<br>[1798, 1828, 0]"]
  36["Sweep Revolve<br>[2275, 2326, 0]"]
  37["Sweep Extrusion<br>[2794, 2847, 0]"]
  38[Wall]
  39[Wall]
  40[Wall]
  41[Wall]
  42[Wall]
  43[Wall]
  44[Wall]
  45[Wall]
  46[Wall]
  47["Cap Start"]
  48["Cap Start"]
  49["Cap Start"]
  50["Cap End"]
  51["Cap End"]
  52["Cap End"]
  53["SweepEdge Opposite"]
  54["SweepEdge Opposite"]
  55["SweepEdge Opposite"]
  56["SweepEdge Adjacent"]
  57["SweepEdge Adjacent"]
  58["SweepEdge Adjacent"]
  59["SweepEdge Adjacent"]
  60["SweepEdge Adjacent"]
  61["SweepEdge Adjacent"]
  62["SweepEdge Adjacent"]
  63["SweepEdge Adjacent"]
  1 <--x 7
  1 --- 8
  1 --- 9
  2 --- 10
  3 --- 11
  4 --- 12
  5 <--x 6
  5 --- 13
  5 --- 14
  8 --- 15
  8 --- 32
  8 ---- 33
  9 --- 16
  9 --- 31
  10 --- 17
  10 --- 18
  10 --- 30
  10 ---- 34
  11 --- 19
  11 --- 20
  11 --- 21
  11 --- 22
  11 --- 27
  11 ---- 35
  12 --- 23
  12 --- 28
  12 ---- 36
  13 --- 24
  13 --- 26
  13 ---- 37
  14 --- 25
  14 --- 29
  15 --- 46
  15 x--> 47
  15 --- 55
  15 --- 63
  34 <--x 17
  17 --- 45
  17 x--> 62
  34 <--x 18
  18 --- 44
  18 --- 62
  35 <--x 19
  19 --- 43
  19 --- 60
  35 <--x 20
  20 --- 41
  20 --- 58
  35 <--x 21
  21 --- 42
  21 --- 61
  35 <--x 22
  22 --- 40
  22 --- 59
  23 --- 38
  23 x--> 49
  23 --- 53
  23 --- 56
  24 --- 39
  24 x--> 48
  24 --- 54
  24 --- 57
  33 --- 46
  33 --- 47
  33 --- 50
  33 --- 55
  33 --- 63
  34 --- 44
  34 --- 45
  34 --- 62
  35 --- 40
  35 --- 41
  35 --- 42
  35 --- 43
  35 --- 58
  35 --- 59
  35 --- 60
  35 --- 61
  36 --- 38
  36 --- 49
  36 --- 52
  36 --- 53
  36 --- 56
  37 --- 39
  37 --- 48
  37 --- 51
  37 --- 54
  37 --- 57
  53 <--x 38
  56 <--x 38
  54 <--x 39
  57 <--x 39
  59 <--x 40
  61 <--x 40
  58 <--x 41
  60 <--x 41
  58 <--x 42
  61 <--x 42
  59 <--x 43
  60 <--x 43
  62 <--x 44
  62 <--x 45
  55 <--x 46
  63 <--x 46
  55 <--x 50
  54 <--x 51
  53 <--x 52
```
