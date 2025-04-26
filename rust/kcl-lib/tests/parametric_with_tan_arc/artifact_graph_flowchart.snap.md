```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[262, 287, 0]"]
    3["Segment<br>[293, 320, 0]"]
    4["Segment<br>[326, 369, 0]"]
    5["Segment<br>[375, 404, 0]"]
    6["Segment<br>[410, 437, 0]"]
    7["Segment<br>[443, 471, 0]"]
    8["Segment<br>[477, 533, 0]"]
    9["Segment<br>[539, 567, 0]"]
    10["Segment<br>[573, 581, 0]"]
    11[Solid2d]
  end
  1["Plane<br>[239, 256, 0]"]
  12["Sweep Extrusion<br>[587, 610, 0]"]
  13[Wall]
  14[Wall]
  15[Wall]
  16[Wall]
  17[Wall]
  18[Wall]
  19[Wall]
  20[Wall]
  21["Cap Start"]
  22["Cap End"]
  23["SweepEdge Opposite"]
  24["SweepEdge Opposite"]
  25["SweepEdge Opposite"]
  26["SweepEdge Opposite"]
  27["SweepEdge Opposite"]
  28["SweepEdge Opposite"]
  29["SweepEdge Opposite"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 --- 9
  2 --- 10
  2 ---- 12
  2 --- 11
  3 --- 13
  3 x--> 21
  4 --- 14
  4 --- 23
  4 x--> 21
  5 --- 15
  5 --- 24
  5 x--> 21
  6 --- 16
  6 --- 25
  6 x--> 21
  7 --- 17
  7 --- 26
  7 x--> 21
  8 --- 18
  8 --- 27
  8 x--> 21
  9 --- 19
  9 --- 28
  9 x--> 21
  10 --- 20
  10 --- 29
  10 x--> 21
  12 --- 13
  12 --- 14
  12 --- 15
  12 --- 16
  12 --- 17
  12 --- 18
  12 --- 19
  12 --- 20
  12 --- 21
  12 --- 22
  12 --- 23
  12 --- 24
  12 --- 25
  12 --- 26
  12 --- 27
  12 --- 28
  12 --- 29
  23 <--x 14
  23 <--x 22
  24 <--x 15
  24 <--x 22
  25 <--x 16
  25 <--x 22
  26 <--x 17
  26 <--x 22
  27 <--x 18
  27 <--x 22
  28 <--x 19
  28 <--x 22
  29 <--x 20
  29 <--x 22
```
