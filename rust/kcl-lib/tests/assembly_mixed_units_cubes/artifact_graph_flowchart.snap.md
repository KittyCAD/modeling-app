```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[76, 116, 8]"]
    5["Segment<br>[122, 139, 8]"]
    6["Segment<br>[145, 163, 8]"]
    7["Segment<br>[169, 187, 8]"]
    8["Segment<br>[193, 249, 8]"]
    9["Segment<br>[255, 262, 8]"]
    15[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[76, 114, 9]"]
    10["Segment<br>[120, 137, 9]"]
    11["Segment<br>[143, 161, 9]"]
    12["Segment<br>[167, 185, 9]"]
    13["Segment<br>[191, 247, 9]"]
    14["Segment<br>[253, 260, 9]"]
    16[Solid2d]
  end
  1["Plane<br>[47, 66, 8]"]
  2["Plane<br>[47, 66, 9]"]
  17["Sweep Extrusion<br>[268, 290, 8]"]
  18["Sweep Extrusion<br>[266, 288, 9]"]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25[Wall]
  26[Wall]
  27["Cap Start"]
  28["Cap Start"]
  29["Cap End"]
  30["Cap End"]
  31["SweepEdge Opposite"]
  32["SweepEdge Adjacent"]
  33["SweepEdge Opposite"]
  34["SweepEdge Adjacent"]
  35["SweepEdge Opposite"]
  36["SweepEdge Adjacent"]
  37["SweepEdge Opposite"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Opposite"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Opposite"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Opposite"]
  44["SweepEdge Adjacent"]
  45["SweepEdge Opposite"]
  46["SweepEdge Adjacent"]
  1 --- 3
  2 --- 4
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 9
  3 --- 15
  3 ---- 17
  4 --- 10
  4 --- 11
  4 --- 12
  4 --- 13
  4 --- 14
  4 --- 16
  4 ---- 18
  5 --- 24
  5 x--> 28
  5 --- 41
  5 --- 42
  6 --- 25
  6 x--> 28
  6 --- 43
  6 --- 44
  7 --- 26
  7 x--> 28
  7 --- 45
  7 --- 46
  8 --- 23
  8 x--> 28
  8 --- 39
  8 --- 40
  10 --- 19
  10 x--> 27
  10 --- 31
  10 --- 32
  11 --- 22
  11 x--> 27
  11 --- 37
  11 --- 38
  12 --- 21
  12 x--> 27
  12 --- 35
  12 --- 36
  13 --- 20
  13 x--> 27
  13 --- 33
  13 --- 34
  17 --- 23
  17 --- 24
  17 --- 25
  17 --- 26
  17 --- 28
  17 --- 30
  17 --- 39
  17 --- 40
  17 --- 41
  17 --- 42
  17 --- 43
  17 --- 44
  17 --- 45
  17 --- 46
  18 --- 19
  18 --- 20
  18 --- 21
  18 --- 22
  18 --- 27
  18 --- 29
  18 --- 31
  18 --- 32
  18 --- 33
  18 --- 34
  18 --- 35
  18 --- 36
  18 --- 37
  18 --- 38
  31 <--x 19
  32 <--x 19
  34 <--x 19
  33 <--x 20
  34 <--x 20
  36 <--x 20
  35 <--x 21
  36 <--x 21
  38 <--x 21
  32 <--x 22
  37 <--x 22
  38 <--x 22
  39 <--x 23
  40 <--x 23
  46 <--x 23
  40 <--x 24
  41 <--x 24
  42 <--x 24
  42 <--x 25
  43 <--x 25
  44 <--x 25
  44 <--x 26
  45 <--x 26
  46 <--x 26
  31 <--x 29
  33 <--x 29
  35 <--x 29
  37 <--x 29
  39 <--x 30
  41 <--x 30
  43 <--x 30
  45 <--x 30
```
