```mermaid
flowchart LR
  subgraph path4 [Path]
    4["Path<br>[671, 741, 0]"]
    7["Segment<br>[671, 741, 0]"]
    16[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[974, 1055, 0]"]
    8["Segment<br>[1061, 1112, 0]"]
    9["Segment<br>[1118, 1169, 0]"]
    10["Segment<br>[1175, 1226, 0]"]
    11["Segment<br>[1232, 1282, 0]"]
    12["Segment<br>[1288, 1338, 0]"]
    13["Segment<br>[1344, 1351, 0]"]
    15[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[1450, 1519, 0]"]
    14["Segment<br>[1450, 1519, 0]"]
    17[Solid2d]
  end
  1["Plane<br>[648, 665, 0]"]
  2["StartSketchOnFace<br>[931, 968, 0]"]
  3["StartSketchOnFace<br>[1409, 1444, 0]"]
  18["Sweep Extrusion<br>[747, 780, 0]"]
  19["Sweep Extrusion<br>[1357, 1397, 0]"]
  20["Sweep Extrusion<br>[1525, 1553, 0]"]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25[Wall]
  26[Wall]
  27[Wall]
  28[Wall]
  29["Cap Start"]
  30["Cap Start"]
  31["Cap End"]
  32["Cap End"]
  33["SweepEdge Opposite"]
  34["SweepEdge Opposite"]
  35["SweepEdge Opposite"]
  36["SweepEdge Opposite"]
  37["SweepEdge Opposite"]
  38["SweepEdge Opposite"]
  39["SweepEdge Opposite"]
  40["SweepEdge Opposite"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Adjacent"]
  44["SweepEdge Adjacent"]
  45["SweepEdge Adjacent"]
  46["SweepEdge Adjacent"]
  47["SweepEdge Adjacent"]
  48["SweepEdge Adjacent"]
  49["EdgeCut Fillet<br>[786, 852, 0]"]
  50["EdgeCut Fillet<br>[786, 852, 0]"]
  51["EdgeCut Fillet<br>[1559, 1618, 0]"]
  1 --- 4
  29 x--> 2
  31 x--> 3
  4 --- 7
  4 --- 16
  4 ---- 18
  5 --- 8
  5 --- 9
  5 --- 10
  5 --- 11
  5 --- 12
  5 --- 13
  5 --- 15
  5 ---- 19
  29 --- 5
  6 --- 14
  6 --- 17
  6 ---- 20
  31 --- 6
  7 --- 28
  7 x--> 31
  7 --- 40
  7 --- 48
  7 --- 50
  8 --- 26
  8 x--> 29
  8 --- 36
  8 --- 43
  9 --- 27
  9 x--> 29
  9 --- 34
  9 --- 45
  10 --- 24
  10 x--> 29
  10 --- 38
  10 --- 47
  11 --- 25
  11 x--> 29
  11 --- 39
  11 --- 42
  12 --- 23
  12 x--> 29
  12 --- 37
  12 --- 46
  13 --- 22
  13 x--> 29
  13 --- 35
  13 --- 44
  14 --- 21
  14 x--> 31
  14 --- 33
  14 --- 41
  18 --- 28
  18 --- 29
  18 --- 31
  18 --- 40
  18 --- 48
  19 --- 22
  19 --- 23
  19 --- 24
  19 --- 25
  19 --- 26
  19 --- 27
  19 --- 30
  19 --- 34
  19 --- 35
  19 --- 36
  19 --- 37
  19 --- 38
  19 --- 39
  19 --- 42
  19 --- 43
  19 --- 44
  19 --- 45
  19 --- 46
  19 --- 47
  20 --- 21
  20 --- 32
  20 --- 33
  20 --- 41
  41 <--x 21
  35 <--x 22
  44 <--x 22
  46 <--x 22
  37 <--x 23
  42 <--x 23
  46 <--x 23
  38 <--x 24
  45 <--x 24
  47 <--x 24
  39 <--x 25
  42 <--x 25
  47 <--x 25
  36 <--x 26
  43 <--x 26
  44 <--x 26
  34 <--x 27
  43 <--x 27
  45 <--x 27
  48 <--x 28
  34 <--x 30
  35 <--x 30
  36 <--x 30
  37 <--x 30
  38 <--x 30
  39 <--x 30
  33 <--x 51
  40 <--x 49
```
