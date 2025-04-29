```mermaid
flowchart LR
  subgraph path6 [Path]
    6["Path<br>[863, 948, 0]"]
    11["Segment<br>[863, 948, 0]"]
    20[Solid2d]
  end
  subgraph path7 [Path]
    7["Path<br>[1185, 1230, 0]"]
    12["Segment<br>[1185, 1230, 0]"]
    18[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[1413, 1467, 0]"]
    13["Segment<br>[1413, 1467, 0]"]
    19[Solid2d]
  end
  subgraph path9 [Path]
    9["Path<br>[1630, 1687, 0]"]
    14["Segment<br>[1630, 1687, 0]"]
    17[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[1822, 1867, 0]"]
    15["Segment<br>[1822, 1867, 0]"]
    16[Solid2d]
  end
  1["Plane<br>[840, 857, 0]"]
  2["Plane<br>[1162, 1179, 0]"]
  3["StartSketchOnFace<br>[1777, 1816, 0]"]
  4["StartSketchOnFace<br>[1370, 1407, 0]"]
  5["StartSketchOnFace<br>[1585, 1624, 0]"]
  21["Sweep Extrusion<br>[1268, 1299, 0]"]
  22["Sweep Extrusion<br>[1473, 1508, 0]"]
  23["Sweep Extrusion<br>[1693, 1726, 0]"]
  24["Sweep Extrusion<br>[1873, 1948, 0]"]
  25[Wall]
  26[Wall]
  27[Wall]
  28[Wall]
  29["Cap End"]
  30["Cap Start"]
  31["Cap End"]
  32["Cap End"]
  33["SweepEdge Opposite"]
  34["SweepEdge Adjacent"]
  35["SweepEdge Opposite"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Opposite"]
  40["SweepEdge Adjacent"]
  1 --- 6
  2 --- 7
  32 x--> 3
  29 x--> 4
  30 x--> 5
  6 --- 11
  6 --- 20
  7 --- 12
  7 --- 18
  7 ---- 21
  8 --- 13
  8 --- 19
  8 ---- 22
  29 --- 8
  9 --- 14
  9 --- 17
  9 ---- 23
  30 --- 9
  10 --- 15
  10 --- 16
  10 ---- 24
  32 --- 10
  12 --- 26
  12 x--> 30
  12 --- 35
  12 --- 36
  13 --- 28
  13 x--> 29
  13 --- 39
  13 --- 40
  14 --- 27
  14 x--> 30
  14 --- 37
  14 --- 38
  15 --- 25
  15 x--> 32
  15 --- 33
  15 --- 34
  21 --- 26
  21 --- 29
  21 --- 30
  21 --- 35
  21 --- 36
  22 --- 28
  22 --- 32
  22 --- 39
  22 --- 40
  23 --- 27
  23 --- 31
  23 --- 37
  23 --- 38
  24 --- 25
  24 --- 33
  24 --- 34
  33 <--x 25
  34 <--x 25
  35 <--x 26
  36 <--x 26
  37 <--x 27
  38 <--x 27
  39 <--x 28
  40 <--x 28
  35 <--x 29
  33 <--x 31
  37 <--x 31
  39 <--x 32
```
