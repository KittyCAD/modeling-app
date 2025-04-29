```mermaid
flowchart LR
  subgraph path5 [Path]
    5["Path<br>[773, 817, 0]"]
    9["Segment<br>[823, 867, 0]"]
    10["Segment<br>[873, 916, 0]"]
    11["Segment<br>[922, 966, 0]"]
    12["Segment<br>[972, 979, 0]"]
    19[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[1066, 1213, 0]"]
    13["Segment<br>[1066, 1213, 0]"]
    18[Solid2d]
  end
  subgraph path7 [Path]
    7["Path<br>[1460, 1609, 0]"]
    14["Segment<br>[1460, 1609, 0]"]
    17[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[1861, 1909, 0]"]
    15["Segment<br>[1861, 1909, 0]"]
    16[Solid2d]
  end
  1["Plane<br>[750, 767, 0]"]
  2["StartSketchOnFace<br>[1824, 1855, 0]"]
  3["StartSketchOnFace<br>[1421, 1454, 0]"]
  4["StartSketchOnFace<br>[1029, 1060, 0]"]
  20["Sweep Extrusion<br>[985, 1009, 0]"]
  21["Sweep Extrusion<br>[1378, 1407, 0]"]
  22["Sweep Extrusion<br>[1378, 1407, 0]"]
  23["Sweep Extrusion<br>[1378, 1407, 0]"]
  24["Sweep Extrusion<br>[1378, 1407, 0]"]
  25["Sweep Extrusion<br>[1774, 1809, 0]"]
  26["Sweep Extrusion<br>[1774, 1809, 0]"]
  27["Sweep Extrusion<br>[1774, 1809, 0]"]
  28["Sweep Extrusion<br>[1774, 1809, 0]"]
  29["Sweep Extrusion<br>[1915, 1940, 0]"]
  30[Wall]
  31[Wall]
  32[Wall]
  33[Wall]
  34[Wall]
  35[Wall]
  36[Wall]
  37["Cap Start"]
  38["Cap Start"]
  39["Cap End"]
  40["SweepEdge Opposite"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Opposite"]
  43["SweepEdge Adjacent"]
  44["SweepEdge Opposite"]
  45["SweepEdge Adjacent"]
  46["SweepEdge Opposite"]
  47["SweepEdge Adjacent"]
  48["SweepEdge Opposite"]
  49["SweepEdge Adjacent"]
  50["SweepEdge Opposite"]
  51["SweepEdge Adjacent"]
  52["SweepEdge Opposite"]
  53["SweepEdge Adjacent"]
  1 --- 5
  39 x--> 2
  37 x--> 3
  39 x--> 4
  5 --- 9
  5 --- 10
  5 --- 11
  5 --- 12
  5 --- 19
  5 ---- 20
  6 --- 13
  6 --- 18
  6 ---- 23
  39 --- 6
  7 --- 14
  7 --- 17
  7 ---- 26
  37 --- 7
  8 --- 15
  8 --- 16
  8 ---- 29
  39 --- 8
  9 --- 34
  9 x--> 37
  9 --- 48
  9 --- 49
  10 --- 32
  10 x--> 37
  10 --- 44
  10 --- 45
  11 --- 31
  11 x--> 37
  11 --- 42
  11 --- 43
  12 --- 33
  12 x--> 37
  12 --- 46
  12 --- 47
  13 --- 35
  13 x--> 39
  13 --- 50
  13 --- 51
  14 --- 30
  14 x--> 37
  14 --- 40
  14 --- 41
  15 --- 36
  15 x--> 39
  15 --- 52
  15 --- 53
  20 --- 31
  20 --- 32
  20 --- 33
  20 --- 34
  20 --- 37
  20 --- 39
  20 --- 42
  20 --- 43
  20 --- 44
  20 --- 45
  20 --- 46
  20 --- 47
  20 --- 48
  20 --- 49
  23 --- 35
  23 --- 38
  23 --- 50
  23 --- 51
  26 --- 30
  26 --- 40
  26 --- 41
  29 --- 36
  29 --- 52
  29 --- 53
  40 <--x 30
  41 <--x 30
  42 <--x 31
  43 <--x 31
  45 <--x 31
  44 <--x 32
  45 <--x 32
  49 <--x 32
  43 <--x 33
  46 <--x 33
  47 <--x 33
  47 <--x 34
  48 <--x 34
  49 <--x 34
  50 <--x 35
  51 <--x 35
  52 <--x 36
  53 <--x 36
  52 <--x 37
  50 <--x 38
  42 <--x 39
  44 <--x 39
  46 <--x 39
  48 <--x 39
```
