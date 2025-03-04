```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[916, 982, 0]"]
    3["Segment<br>[916, 982, 0]"]
    4[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[993, 1099, 0]"]
    6["Segment<br>[993, 1099, 0]"]
    7[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[1114, 1220, 0]"]
    9["Segment<br>[1114, 1220, 0]"]
    10[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[1235, 1342, 0]"]
    12["Segment<br>[1235, 1342, 0]"]
    13[Solid2d]
  end
  subgraph path14 [Path]
    14["Path<br>[1357, 1464, 0]"]
    15["Segment<br>[1357, 1464, 0]"]
    16[Solid2d]
  end
  subgraph path17 [Path]
    17["Path<br>[1479, 1545, 0]"]
    18["Segment<br>[1479, 1545, 0]"]
    19[Solid2d]
  end
  subgraph path27 [Path]
    27["Path<br>[1915, 1990, 0]"]
    28["Segment<br>[1915, 1990, 0]"]
    29[Solid2d]
  end
  subgraph path30 [Path]
    30["Path<br>[2001, 2067, 0]"]
    31["Segment<br>[2001, 2067, 0]"]
    32[Solid2d]
  end
  subgraph path40 [Path]
    40["Path<br>[2214, 2292, 0]"]
    41["Segment<br>[2214, 2292, 0]"]
    42[Solid2d]
  end
  subgraph path43 [Path]
    43["Path<br>[2303, 2369, 0]"]
    44["Segment<br>[2303, 2369, 0]"]
    45[Solid2d]
  end
  1["Plane<br>[891, 910, 0]"]
  20["Sweep Extrusion<br>[1555, 1586, 0]"]
  21[Wall]
  22["Cap Start"]
  23["Cap End"]
  24["SweepEdge Opposite"]
  25["SweepEdge Adjacent"]
  26["Plane<br>[1875, 1909, 0]"]
  33["Sweep Extrusion<br>[2077, 2112, 0]"]
  34[Wall]
  35["Cap Start"]
  36["Cap End"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["Plane<br>[2189, 2208, 0]"]
  46["Sweep Extrusion<br>[2379, 2413, 0]"]
  47[Wall]
  48["Cap Start"]
  49["Cap End"]
  50["SweepEdge Opposite"]
  51["SweepEdge Adjacent"]
  1 --- 2
  1 --- 5
  1 --- 8
  1 --- 11
  1 --- 14
  1 --- 17
  2 --- 3
  2 ---- 20
  2 --- 4
  3 --- 21
  3 --- 24
  3 --- 25
  5 --- 6
  5 --- 7
  8 --- 9
  8 --- 10
  11 --- 12
  11 --- 13
  14 --- 15
  14 --- 16
  17 --- 18
  17 --- 19
  20 --- 21
  20 --- 22
  20 --- 23
  20 --- 24
  20 --- 25
  26 --- 27
  26 --- 30
  27 --- 28
  27 ---- 33
  27 --- 29
  28 --- 34
  28 --- 37
  28 --- 38
  30 --- 31
  30 --- 32
  33 --- 34
  33 --- 35
  33 --- 36
  33 --- 37
  33 --- 38
  39 --- 40
  39 --- 43
  40 --- 41
  40 ---- 46
  40 --- 42
  41 --- 47
  41 --- 50
  41 --- 51
  43 --- 44
  43 --- 45
  46 --- 47
  46 --- 48
  46 --- 49
  46 --- 50
  46 --- 51
```
