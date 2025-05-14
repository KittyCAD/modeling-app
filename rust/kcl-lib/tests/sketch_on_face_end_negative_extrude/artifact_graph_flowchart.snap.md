```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[54, 76, 0]"]
    5["Segment<br>[84, 106, 0]"]
    6["Segment<br>[114, 136, 0]"]
    7["Segment<br>[144, 167, 0]"]
    8["Segment<br>[229, 237, 0]"]
    13[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[317, 342, 0]"]
    9["Segment<br>[348, 367, 0]"]
    10["Segment<br>[373, 392, 0]"]
    11["Segment<br>[398, 418, 0]"]
    12["Segment<br>[424, 432, 0]"]
    14[Solid2d]
  end
  1["Plane<br>[29, 46, 0]"]
  2["StartSketchOnFace<br>[275, 311, 0]"]
  15["Sweep Extrusion<br>[243, 263, 0]"]
  16["Sweep Extrusion<br>[438, 458, 0]"]
  17[Wall]
  18[Wall]
  19[Wall]
  20[Wall]
  21[Wall]
  22[Wall]
  23[Wall]
  24[Wall]
  25["Cap Start"]
  26["Cap Start"]
  27["Cap End"]
  28["Cap End"]
  29["SweepEdge Opposite"]
  30["SweepEdge Opposite"]
  31["SweepEdge Opposite"]
  32["SweepEdge Opposite"]
  33["SweepEdge Opposite"]
  34["SweepEdge Opposite"]
  35["SweepEdge Opposite"]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Adjacent"]
  39["SweepEdge Adjacent"]
  40["SweepEdge Adjacent"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Adjacent"]
  43["SweepEdge Adjacent"]
  44["SweepEdge Adjacent"]
  1 --- 3
  28 x--> 2
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 13
  3 ---- 15
  4 --- 9
  4 --- 10
  4 --- 11
  4 --- 12
  4 --- 14
  4 ---- 16
  28 --- 4
  5 --- 20
  5 x--> 26
  5 --- 32
  5 --- 40
  6 --- 18
  6 x--> 26
  6 --- 31
  6 --- 39
  7 --- 17
  7 x--> 26
  7 --- 30
  7 --- 38
  8 --- 19
  8 x--> 26
  8 --- 29
  8 --- 37
  9 --- 23
  9 x--> 27
  9 --- 36
  9 --- 44
  10 --- 22
  10 x--> 27
  10 --- 35
  10 --- 43
  11 --- 24
  11 x--> 27
  11 --- 34
  11 --- 42
  12 --- 21
  12 x--> 27
  12 --- 33
  12 --- 41
  15 --- 17
  15 --- 18
  15 --- 19
  15 --- 20
  15 --- 26
  15 --- 28
  15 --- 29
  15 --- 30
  15 --- 31
  15 --- 32
  15 --- 37
  15 --- 38
  15 --- 39
  15 --- 40
  16 --- 21
  16 --- 22
  16 --- 23
  16 --- 24
  16 --- 25
  16 --- 27
  16 --- 33
  16 --- 34
  16 --- 35
  16 --- 36
  16 --- 41
  16 --- 42
  16 --- 43
  16 --- 44
  17 --- 30
  17 --- 38
  39 <--x 17
  18 --- 31
  18 --- 39
  40 <--x 18
  19 --- 29
  19 --- 37
  38 <--x 19
  20 --- 32
  37 <--x 20
  20 --- 40
  21 --- 33
  21 --- 41
  42 <--x 21
  22 --- 35
  22 --- 43
  44 <--x 22
  23 --- 36
  41 <--x 23
  23 --- 44
  24 --- 34
  24 --- 42
  43 <--x 24
  33 <--x 25
  34 <--x 25
  35 <--x 25
  36 <--x 25
  29 <--x 28
  30 <--x 28
  31 <--x 28
  32 <--x 28
```
