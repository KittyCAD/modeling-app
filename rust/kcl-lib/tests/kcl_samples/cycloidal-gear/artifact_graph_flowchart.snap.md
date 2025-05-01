```mermaid
flowchart LR
  subgraph path7 [Path]
    7["Path<br>[645, 835, 0]"]
    13["Segment<br>[845, 929, 0]"]
    16["Segment<br>[939, 991, 0]"]
    17["Segment<br>[1001, 1048, 0]"]
    19["Segment<br>[1058, 1110, 0]"]
    21["Segment<br>[1120, 1167, 0]"]
    23["Segment<br>[1177, 1242, 0]"]
    27["Segment<br>[1252, 1260, 0]"]
    31[Solid2d]
  end
  subgraph path8 [Path]
    8["Path<br>[645, 835, 0]"]
    26["Segment<br>[1252, 1260, 0]"]
    32[Solid2d]
  end
  subgraph path9 [Path]
    9["Path<br>[645, 835, 0]"]
    14["Segment<br>[845, 929, 0]"]
    15["Segment<br>[939, 991, 0]"]
    18["Segment<br>[1001, 1048, 0]"]
    20["Segment<br>[1058, 1110, 0]"]
    22["Segment<br>[1120, 1167, 0]"]
    24["Segment<br>[1177, 1242, 0]"]
    25["Segment<br>[1252, 1260, 0]"]
    36[Solid2d]
  end
  subgraph path10 [Path]
    10["Path<br>[1288, 1338, 0]"]
    29["Segment<br>[1288, 1338, 0]"]
    33[Solid2d]
  end
  subgraph path11 [Path]
    11["Path<br>[1288, 1338, 0]"]
    30["Segment<br>[1288, 1338, 0]"]
    34[Solid2d]
  end
  subgraph path12 [Path]
    12["Path<br>[1288, 1338, 0]"]
    28["Segment<br>[1288, 1338, 0]"]
    35[Solid2d]
  end
  1["Plane<br>[601, 634, 0]"]
  2["Plane<br>[601, 634, 0]"]
  3["Plane<br>[601, 634, 0]"]
  4["StartSketchOnPlane<br>[587, 635, 0]"]
  5["StartSketchOnPlane<br>[587, 635, 0]"]
  6["StartSketchOnPlane<br>[587, 635, 0]"]
  37["Sweep Loft<br>[1465, 1554, 0]"]
  38[Wall]
  39[Wall]
  40[Wall]
  41[Wall]
  42[Wall]
  43[Wall]
  44["Cap Start"]
  45["Cap End"]
  46["SweepEdge Opposite"]
  47["SweepEdge Opposite"]
  48["SweepEdge Opposite"]
  49["SweepEdge Opposite"]
  50["SweepEdge Opposite"]
  51["SweepEdge Opposite"]
  52["SweepEdge Adjacent"]
  53["SweepEdge Adjacent"]
  54["SweepEdge Adjacent"]
  55["SweepEdge Adjacent"]
  56["SweepEdge Adjacent"]
  57["SweepEdge Adjacent"]
  1 <--x 6
  1 --- 7
  1 --- 12
  2 <--x 4
  2 --- 8
  2 --- 10
  3 <--x 5
  3 --- 9
  3 --- 11
  7 --- 13
  7 --- 16
  7 --- 17
  7 --- 19
  7 --- 21
  7 --- 23
  7 --- 27
  7 --- 31
  7 x---> 37
  8 --- 26
  8 --- 32
  8 x---> 37
  8 x--> 46
  8 x--> 47
  8 x--> 48
  8 x--> 49
  8 x--> 50
  8 x--> 51
  9 --- 14
  9 --- 15
  9 --- 18
  9 --- 20
  9 --- 22
  9 --- 24
  9 --- 25
  9 --- 36
  9 ---- 37
  10 --- 29
  10 --- 33
  11 --- 30
  11 --- 34
  12 --- 28
  12 --- 35
  14 --- 40
  14 x--> 44
  14 --- 46
  14 --- 55
  15 --- 39
  15 x--> 44
  15 --- 51
  15 --- 52
  18 --- 38
  18 x--> 44
  18 --- 48
  18 --- 53
  20 --- 41
  20 x--> 44
  20 --- 50
  20 --- 56
  22 --- 43
  22 x--> 44
  22 --- 49
  22 --- 54
  24 --- 42
  24 x--> 44
  24 --- 47
  24 --- 57
  37 --- 38
  37 --- 39
  37 --- 40
  37 --- 41
  37 --- 42
  37 --- 43
  37 --- 44
  37 --- 45
  37 --- 46
  37 --- 47
  37 --- 48
  37 --- 49
  37 --- 50
  37 --- 51
  37 --- 52
  37 --- 53
  37 --- 54
  37 --- 55
  37 --- 56
  37 --- 57
  48 <--x 38
  53 <--x 38
  56 <--x 38
  51 <--x 39
  52 <--x 39
  53 <--x 39
  46 <--x 40
  52 <--x 40
  55 <--x 40
  50 <--x 41
  54 <--x 41
  56 <--x 41
  47 <--x 42
  55 <--x 42
  57 <--x 42
  49 <--x 43
  54 <--x 43
  57 <--x 43
  46 <--x 45
  47 <--x 45
  48 <--x 45
  49 <--x 45
  50 <--x 45
  51 <--x 45
```
