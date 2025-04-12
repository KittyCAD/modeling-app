```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[2001, 2026, 0]"]
    3["Segment<br>[2032, 2090, 0]"]
    4["Segment<br>[2096, 2135, 0]"]
    5["Segment<br>[2141, 2188, 0]"]
    6["Segment<br>[2194, 2240, 0]"]
    7["Segment<br>[2246, 2285, 0]"]
    8["Segment<br>[2291, 2361, 0]"]
    9["Segment<br>[2367, 2374, 0]"]
    10[Solid2d]
  end
  subgraph path32 [Path]
    32["Path<br>[2512, 2702, 0]"]
    33["Segment<br>[2512, 2702, 0]"]
    34[Solid2d]
  end
  subgraph path42 [Path]
    42["Path<br>[3129, 3331, 0]"]
    43["Segment<br>[3129, 3331, 0]"]
    44[Solid2d]
  end
  1["Plane<br>[1978, 1995, 0]"]
  11["Sweep Extrusion<br>[2380, 2406, 0]"]
  12[Wall]
  13[Wall]
  14[Wall]
  15[Wall]
  16[Wall]
  17[Wall]
  18["Cap Start"]
  19["Cap End"]
  20["SweepEdge Opposite"]
  21["SweepEdge Adjacent"]
  22["SweepEdge Opposite"]
  23["SweepEdge Adjacent"]
  24["SweepEdge Opposite"]
  25["SweepEdge Adjacent"]
  26["SweepEdge Opposite"]
  27["SweepEdge Adjacent"]
  28["SweepEdge Opposite"]
  29["SweepEdge Adjacent"]
  30["SweepEdge Opposite"]
  31["SweepEdge Adjacent"]
  35["Sweep Extrusion<br>[2988, 3025, 0]"]
  36[Wall]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["Sweep Extrusion<br>[2988, 3025, 0]"]
  40["Sweep Extrusion<br>[2988, 3025, 0]"]
  41["Sweep Extrusion<br>[2988, 3025, 0]"]
  45["Sweep Extrusion<br>[3446, 3483, 0]"]
  46[Wall]
  47["SweepEdge Opposite"]
  48["SweepEdge Adjacent"]
  49["Sweep Extrusion<br>[3446, 3483, 0]"]
  50["EdgeCut Fillet<br>[3500, 3580, 0]"]
  51["EdgeCut Fillet<br>[3581, 3658, 0]"]
  52["EdgeCut Fillet<br>[3684, 3826, 0]"]
  53["EdgeCut Fillet<br>[3684, 3826, 0]"]
  54["EdgeCut Fillet<br>[3684, 3826, 0]"]
  55["EdgeCut Fillet<br>[3684, 3826, 0]"]
  56["StartSketchOnFace<br>[2473, 2506, 0]"]
  57["StartSketchOnFace<br>[3090, 3123, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 --- 9
  2 ---- 11
  2 --- 10
  3 --- 12
  3 --- 20
  3 --- 21
  4 --- 13
  4 --- 22
  4 --- 23
  4 --- 52
  5 --- 14
  5 --- 24
  5 --- 25
  6 --- 15
  6 --- 26
  6 --- 27
  7 --- 16
  7 --- 28
  7 --- 29
  7 --- 54
  8 --- 17
  8 --- 30
  8 --- 31
  11 --- 12
  11 --- 13
  11 --- 14
  11 --- 15
  11 --- 16
  11 --- 17
  11 --- 18
  11 --- 19
  11 --- 20
  11 --- 21
  11 --- 22
  11 --- 23
  11 --- 24
  11 --- 25
  11 --- 26
  11 --- 27
  11 --- 28
  11 --- 29
  11 --- 30
  11 --- 31
  14 --- 32
  15 --- 42
  32 --- 33
  32 ---- 35
  32 --- 34
  33 --- 36
  33 --- 37
  33 --- 38
  35 --- 36
  35 --- 37
  35 --- 38
  42 --- 43
  42 ---- 45
  42 --- 44
  43 --- 46
  43 --- 47
  43 --- 48
  45 --- 46
  45 --- 47
  45 --- 48
  25 <--x 50
  31 <--x 51
  22 <--x 53
  28 <--x 55
  14 <--x 56
  15 <--x 57
```
