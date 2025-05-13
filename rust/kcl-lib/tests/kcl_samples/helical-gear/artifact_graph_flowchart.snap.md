```mermaid
flowchart LR
  subgraph path8 [Path]
    8["Path<br>[889, 995, 0]"]
    12["Segment<br>[1003, 1030, 0]"]
    13["Segment<br>[1038, 1066, 0]"]
    14["Segment<br>[1074, 1102, 0]"]
    15["Segment<br>[1110, 1186, 0]"]
    16["Segment<br>[1194, 1259, 0]"]
    17["Segment<br>[1267, 1274, 0]"]
    30[Solid2d]
  end
  subgraph path9 [Path]
    9["Path<br>[1779, 1849, 0]"]
    26["Segment<br>[2813, 2820, 0]"]
    29[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[1779, 1849, 0]"]
    19["Segment<br>[1859, 2025, 0]"]
    20["Segment<br>[2035, 2120, 0]"]
    23["Segment<br>[2130, 2351, 0]"]
    24["Segment<br>[2438, 2524, 0]"]
    28["Segment<br>[2813, 2820, 0]"]
    31[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[1779, 1849, 0]"]
    18["Segment<br>[1859, 2025, 0]"]
    21["Segment<br>[2035, 2120, 0]"]
    22["Segment<br>[2130, 2351, 0]"]
    25["Segment<br>[2438, 2524, 0]"]
    27["Segment<br>[2813, 2820, 0]"]
    32[Solid2d]
  end
  1["Plane<br>[864, 881, 0]"]
  2["Plane<br>[1730, 1768, 0]"]
  3["Plane<br>[1730, 1768, 0]"]
  4["Plane<br>[1730, 1768, 0]"]
  5["StartSketchOnPlane<br>[1716, 1769, 0]"]
  6["StartSketchOnPlane<br>[1716, 1769, 0]"]
  7["StartSketchOnPlane<br>[1716, 1769, 0]"]
  33["Sweep Loft<br>[3337, 3404, 0]"]
  34[Wall]
  35[Wall]
  36[Wall]
  37[Wall]
  38["Cap Start"]
  39["Cap End"]
  40["SweepEdge Opposite"]
  41["SweepEdge Opposite"]
  42["SweepEdge Opposite"]
  43["SweepEdge Opposite"]
  44["SweepEdge Adjacent"]
  45["SweepEdge Adjacent"]
  46["SweepEdge Adjacent"]
  47["SweepEdge Adjacent"]
  1 --- 8
  2 <--x 7
  2 --- 9
  3 <--x 5
  3 --- 10
  4 <--x 6
  4 --- 11
  8 --- 12
  8 --- 13
  8 --- 14
  8 --- 15
  8 --- 16
  8 --- 17
  8 --- 30
  9 --- 26
  9 --- 29
  9 x---> 33
  9 x--> 40
  9 x--> 41
  9 x--> 42
  9 x--> 43
  10 --- 19
  10 --- 20
  10 --- 23
  10 --- 24
  10 --- 28
  10 --- 31
  10 x---> 33
  11 --- 18
  11 --- 21
  11 --- 22
  11 --- 25
  11 --- 27
  11 --- 32
  11 ---- 33
  18 --- 34
  18 x--> 38
  18 --- 41
  18 --- 47
  21 --- 36
  21 x--> 38
  21 --- 42
  21 --- 44
  22 --- 35
  22 x--> 38
  22 --- 40
  22 --- 46
  25 --- 37
  25 x--> 38
  25 --- 43
  25 --- 45
  33 --- 34
  33 --- 35
  33 --- 36
  33 --- 37
  33 --- 38
  33 --- 39
  33 --- 40
  33 --- 41
  33 --- 42
  33 --- 43
  33 --- 44
  33 --- 45
  33 --- 46
  33 --- 47
  41 <--x 34
  44 <--x 34
  47 <--x 34
  40 <--x 35
  45 <--x 35
  46 <--x 35
  42 <--x 36
  44 <--x 36
  46 <--x 36
  43 <--x 37
  45 <--x 37
  40 <--x 39
  41 <--x 39
  42 <--x 39
  43 <--x 39
```
