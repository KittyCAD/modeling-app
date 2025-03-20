```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[994, 1048, 0]"]
    3["Segment<br>[1054, 1081, 0]"]
    4["Segment<br>[1087, 1115, 0]"]
    5["Segment<br>[1121, 1149, 0]"]
    6["Segment<br>[1155, 1162, 0]"]
    7[Solid2d]
  end
  subgraph path23 [Path]
    23["Path<br>[1404, 1491, 0]"]
    24["Segment<br>[1497, 1534, 0]"]
    25["Segment<br>[1540, 1578, 0]"]
    26["Segment<br>[1584, 1624, 0]"]
    27["Segment<br>[1630, 1637, 0]"]
    28[Solid2d]
  end
  subgraph path43 [Path]
    43["Path<br>[1756, 1902, 0]"]
    44["Segment<br>[1756, 1902, 0]"]
    45[Solid2d]
  end
  subgraph path58 [Path]
    58["Path<br>[2243, 2417, 0]"]
    59["Segment<br>[2243, 2417, 0]"]
    60[Solid2d]
  end
  1["Plane<br>[969, 988, 0]"]
  8["Sweep Extrusion<br>[1168, 1192, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  29["Sweep Extrusion<br>[1643, 1674, 0]"]
  30[Wall]
  31[Wall]
  32[Wall]
  33[Wall]
  34["Cap Start"]
  35["SweepEdge Opposite"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Opposite"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Opposite"]
  42["SweepEdge Adjacent"]
  46["Sweep Extrusion<br>[2112, 2140, 0]"]
  47[Wall]
  48["Cap End"]
  49["SweepEdge Opposite"]
  50["SweepEdge Adjacent"]
  51["Sweep Extrusion<br>[2112, 2140, 0]"]
  52["Sweep Extrusion<br>[2112, 2140, 0]"]
  53["Sweep Extrusion<br>[2112, 2140, 0]"]
  54["Sweep Extrusion<br>[2112, 2140, 0]"]
  55["Sweep Extrusion<br>[2112, 2140, 0]"]
  56["Sweep Extrusion<br>[2112, 2140, 0]"]
  57["Sweep Extrusion<br>[2112, 2140, 0]"]
  61["Sweep Extrusion<br>[2635, 2663, 0]"]
  62[Wall]
  63["Cap End"]
  64["SweepEdge Opposite"]
  65["SweepEdge Adjacent"]
  66["Sweep Extrusion<br>[2635, 2663, 0]"]
  67["Sweep Extrusion<br>[2635, 2663, 0]"]
  68["StartSketchOnFace<br>[1370, 1398, 0]"]
  69["StartSketchOnFace<br>[1724, 1750, 0]"]
  70["StartSketchOnFace<br>[2201, 2237, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 --- 9
  3 --- 15
  3 --- 16
  4 --- 10
  4 --- 17
  4 --- 18
  5 --- 11
  5 --- 19
  5 --- 20
  6 --- 12
  6 --- 21
  6 --- 22
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  8 --- 14
  8 --- 15
  8 --- 16
  8 --- 17
  8 --- 18
  8 --- 19
  8 --- 20
  8 --- 21
  8 --- 22
  13 --- 23
  14 --- 43
  23 --- 24
  23 --- 25
  23 --- 26
  23 --- 27
  23 ---- 29
  23 --- 28
  24 --- 30
  24 --- 35
  24 --- 36
  25 --- 31
  25 --- 37
  25 --- 38
  26 --- 32
  26 --- 39
  26 --- 40
  27 --- 33
  27 --- 41
  27 --- 42
  29 --- 30
  29 --- 31
  29 --- 32
  29 --- 33
  29 --- 34
  29 --- 35
  29 --- 36
  29 --- 37
  29 --- 38
  29 --- 39
  29 --- 40
  29 --- 41
  29 --- 42
  34 --- 58
  43 --- 44
  43 ---- 46
  43 --- 45
  44 --- 47
  44 --- 49
  44 --- 50
  46 --- 47
  46 --- 48
  46 --- 49
  46 --- 50
  58 --- 59
  58 ---- 61
  58 --- 60
  59 --- 62
  59 --- 64
  59 --- 65
  61 --- 62
  61 --- 63
  61 --- 64
  61 --- 65
  13 <--x 68
  14 <--x 69
  34 <--x 70
```
