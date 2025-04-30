```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[54, 76, 0]"]
    5["Segment<br>[84, 106, 0]"]
    6["Segment<br>[114, 136, 0]"]
    7["Segment<br>[144, 167, 0]"]
    8["Segment<br>[215, 223, 0]"]
    14[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[308, 333, 0]"]
    9["Segment<br>[339, 358, 0]"]
    10["Segment<br>[364, 383, 0]"]
    11["Segment<br>[389, 409, 0]"]
    12["Segment<br>[415, 423, 0]"]
    13[Solid2d]
  end
  1["Plane<br>[29, 46, 0]"]
  2["StartSketchOnFace<br>[268, 302, 0]"]
  15["Sweep Extrusion<br>[229, 249, 0]"]
  16["Sweep Extrusion<br>[429, 448, 0]"]
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
  25 x--> 2
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 14
  3 ---- 15
  4 --- 9
  4 --- 10
  4 --- 11
  4 --- 12
  4 --- 13
  4 ---- 16
  25 --- 4
  5 --- 20
  5 x--> 25
  5 --- 31
  5 --- 38
  6 --- 18
  6 x--> 25
  6 --- 32
  6 --- 39
  7 --- 17
  7 x--> 25
  7 --- 29
  7 --- 40
  8 --- 19
  8 x--> 25
  8 --- 30
  8 --- 37
  9 --- 23
  9 x--> 26
  9 --- 35
  9 --- 44
  10 --- 24
  10 x--> 26
  10 --- 36
  10 --- 42
  11 --- 22
  11 x--> 26
  11 --- 33
  11 --- 43
  12 --- 21
  12 x--> 26
  12 --- 34
  12 --- 41
  15 --- 17
  15 --- 18
  15 --- 19
  15 --- 20
  15 --- 25
  15 --- 27
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
  16 --- 26
  16 --- 28
  16 --- 33
  16 --- 34
  16 --- 35
  16 --- 36
  16 --- 41
  16 --- 42
  16 --- 43
  16 --- 44
  29 <--x 17
  39 <--x 17
  40 <--x 17
  32 <--x 18
  38 <--x 18
  39 <--x 18
  30 <--x 19
  37 <--x 19
  40 <--x 19
  31 <--x 20
  37 <--x 20
  38 <--x 20
  34 <--x 21
  41 <--x 21
  43 <--x 21
  33 <--x 22
  42 <--x 22
  43 <--x 22
  35 <--x 23
  41 <--x 23
  44 <--x 23
  36 <--x 24
  42 <--x 24
  44 <--x 24
  29 <--x 27
  30 <--x 27
  31 <--x 27
  32 <--x 27
  33 <--x 28
  34 <--x 28
  35 <--x 28
  36 <--x 28
```
