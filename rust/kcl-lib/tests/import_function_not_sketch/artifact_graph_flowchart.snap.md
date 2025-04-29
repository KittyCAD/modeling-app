```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[75, 101, 8]"]
    3["Segment<br>[107, 125, 8]"]
    4["Segment<br>[131, 150, 8]"]
    5["Segment<br>[156, 175, 8]"]
    6["Segment<br>[181, 200, 8]"]
    7["Segment<br>[206, 231, 8]"]
    8["Segment<br>[237, 258, 8]"]
    9["Segment<br>[264, 283, 8]"]
    10["Segment<br>[289, 296, 8]"]
    11[Solid2d]
  end
  1["Plane<br>[52, 69, 8]"]
  12["Sweep Revolve<br>[302, 319, 8]"]
  13[Wall]
  14[Wall]
  15[Wall]
  16[Wall]
  17[Wall]
  18[Wall]
  19[Wall]
  20[Wall]
  21["SweepEdge Adjacent"]
  22["SweepEdge Adjacent"]
  23["SweepEdge Adjacent"]
  24["SweepEdge Adjacent"]
  25["SweepEdge Adjacent"]
  26["SweepEdge Adjacent"]
  27["SweepEdge Adjacent"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 --- 8
  2 --- 9
  2 --- 10
  2 --- 11
  2 ---- 12
  12 <--x 3
  3 --- 15
  3 x--> 25
  12 <--x 4
  4 --- 18
  4 --- 25
  12 <--x 5
  5 --- 20
  5 --- 27
  12 <--x 6
  6 --- 13
  6 --- 21
  12 <--x 7
  7 --- 16
  7 --- 23
  12 <--x 8
  8 --- 17
  8 <--x 24
  12 <--x 9
  9 --- 14
  9 --- 22
  12 <--x 10
  10 --- 19
  10 --- 26
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
  21 <--x 13
  27 <--x 13
  22 <--x 14
  24 <--x 14
  25 <--x 15
  26 <--x 15
  21 <--x 16
  23 <--x 16
  23 <--x 17
  24 <--x 17
  25 <--x 18
  22 <--x 19
  26 <--x 19
  27 <--x 20
```
