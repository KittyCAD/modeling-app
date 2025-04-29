```mermaid
flowchart LR
  subgraph path4 [Path]
    4["Path<br>[2065, 2090, 0]"]
    7["Segment<br>[2096, 2154, 0]"]
    8["Segment<br>[2160, 2199, 0]"]
    9["Segment<br>[2205, 2252, 0]"]
    10["Segment<br>[2258, 2304, 0]"]
    11["Segment<br>[2310, 2349, 0]"]
    12["Segment<br>[2355, 2425, 0]"]
    13["Segment<br>[2431, 2438, 0]"]
    17[Solid2d]
  end
  subgraph path5 [Path]
    5["Path<br>[2583, 2773, 0]"]
    14["Segment<br>[2583, 2773, 0]"]
    16[Solid2d]
  end
  subgraph path6 [Path]
    6["Path<br>[3207, 3409, 0]"]
    15["Segment<br>[3207, 3409, 0]"]
    18[Solid2d]
  end
  1["Plane<br>[2042, 2059, 0]"]
  2["StartSketchOnFace<br>[3161, 3201, 0]"]
  3["StartSketchOnFace<br>[2537, 2577, 0]"]
  19["Sweep Extrusion<br>[2444, 2470, 0]"]
  20["Sweep Extrusion<br>[3059, 3096, 0]"]
  21["Sweep Extrusion<br>[3059, 3096, 0]"]
  22["Sweep Extrusion<br>[3059, 3096, 0]"]
  23["Sweep Extrusion<br>[3059, 3096, 0]"]
  24["Sweep Extrusion<br>[3524, 3561, 0]"]
  25["Sweep Extrusion<br>[3524, 3561, 0]"]
  26[Wall]
  27[Wall]
  28[Wall]
  29[Wall]
  30[Wall]
  31[Wall]
  32[Wall]
  33[Wall]
  34["Cap Start"]
  35["Cap End"]
  36["SweepEdge Opposite"]
  37["SweepEdge Opposite"]
  38["SweepEdge Opposite"]
  39["SweepEdge Opposite"]
  40["SweepEdge Opposite"]
  41["SweepEdge Opposite"]
  42["SweepEdge Opposite"]
  43["SweepEdge Opposite"]
  44["SweepEdge Adjacent"]
  45["SweepEdge Adjacent"]
  46["SweepEdge Adjacent"]
  47["SweepEdge Adjacent"]
  48["SweepEdge Adjacent"]
  49["SweepEdge Adjacent"]
  50["SweepEdge Adjacent"]
  51["SweepEdge Adjacent"]
  52["EdgeCut Fillet<br>[3578, 3658, 0]"]
  53["EdgeCut Fillet<br>[3659, 3736, 0]"]
  54["EdgeCut Fillet<br>[3762, 3904, 0]"]
  55["EdgeCut Fillet<br>[3762, 3904, 0]"]
  56["EdgeCut Fillet<br>[3762, 3904, 0]"]
  57["EdgeCut Fillet<br>[3762, 3904, 0]"]
  1 --- 4
  33 x--> 2
  32 x--> 3
  4 --- 7
  4 --- 8
  4 --- 9
  4 --- 10
  4 --- 11
  4 --- 12
  4 --- 13
  4 --- 17
  4 ---- 19
  5 --- 14
  5 --- 16
  5 ---- 21
  32 --- 5
  6 --- 15
  6 --- 18
  6 ---- 24
  33 --- 6
  7 --- 31
  7 x--> 34
  7 --- 42
  7 --- 50
  8 --- 30
  8 x--> 34
  8 --- 40
  8 --- 47
  8 --- 54
  9 --- 32
  9 x--> 34
  9 --- 41
  9 --- 51
  10 --- 33
  10 x--> 34
  10 --- 43
  10 --- 46
  11 --- 29
  11 x--> 34
  11 --- 38
  11 --- 48
  11 --- 56
  12 --- 28
  12 x--> 34
  12 --- 39
  12 --- 49
  14 --- 27
  14 x--> 32
  14 --- 37
  14 --- 45
  15 --- 26
  15 x--> 33
  15 --- 36
  15 --- 44
  19 --- 28
  19 --- 29
  19 --- 30
  19 --- 31
  19 --- 32
  19 --- 33
  19 --- 34
  19 --- 35
  19 --- 38
  19 --- 39
  19 --- 40
  19 --- 41
  19 --- 42
  19 --- 43
  19 --- 46
  19 --- 47
  19 --- 48
  19 --- 49
  19 --- 50
  19 --- 51
  21 --- 27
  21 --- 37
  21 --- 45
  24 --- 26
  24 --- 36
  24 --- 44
  36 <--x 26
  44 <--x 26
  37 <--x 27
  45 <--x 27
  36 <--x 28
  39 <--x 28
  48 <--x 28
  46 <--x 29
  48 <--x 29
  47 <--x 30
  50 <--x 30
  37 <--x 31
  42 <--x 31
  50 <--x 31
  41 <--x 32
  47 <--x 32
  43 <--x 33
  46 <--x 33
  39 <--x 35
  41 <--x 35
  42 <--x 35
  43 <--x 35
  38 <--x 55
  40 <--x 57
  49 <--x 53
  51 <--x 52
```
