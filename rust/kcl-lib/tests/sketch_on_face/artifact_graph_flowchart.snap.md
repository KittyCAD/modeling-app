```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[33, 66, 0]"]
    3["Segment<br>[72, 112, 0]"]
    4["Segment<br>[118, 145, 0]"]
    5["Segment<br>[151, 178, 0]"]
    6["Segment<br>[184, 192, 0]"]
    7[Solid2d]
  end
  subgraph path23 [Path]
    23["Path<br>[270, 295, 0]"]
    24["Segment<br>[301, 320, 0]"]
    25["Segment<br>[326, 345, 0]"]
    26["Segment<br>[351, 371, 0]"]
    27["Segment<br>[377, 385, 0]"]
    28[Solid2d]
  end
  1["Plane<br>[10, 27, 0]"]
  8["Sweep Extrusion<br>[198, 217, 0]"]
  9[Wall]
  10[Wall]
  11[Wall]
  12[Wall]
  13["Cap Start"]
  14["Cap End"]
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  29["Sweep Extrusion<br>[391, 410, 0]"]
  30[Wall]
  31[Wall]
  32[Wall]
  33[Wall]
  34["Cap Start"]
  35["Cap End"]
  36["SweepEdge Opposite"]
  37["SweepEdge Adjacent"]
  38["SweepEdge Opposite"]
  39["SweepEdge Adjacent"]
  40["SweepEdge Opposite"]
  41["SweepEdge Adjacent"]
  42["SweepEdge Opposite"]
  43["SweepEdge Adjacent"]
  44["StartSketchOnFace<br>[229, 264, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 ---- 8
  2 --- 7
  3 --- 12
  3 --- 21
  3 --- 22
  4 --- 11
  4 --- 19
  4 --- 20
  5 --- 10
  5 --- 17
  5 --- 18
  6 --- 9
  6 --- 15
  6 --- 16
  8 --- 9
  8 --- 10
  8 --- 11
  8 --- 12
  8 --- 13
  8 --- 14
  8 --- 15
  8 --- 16
  8 --- 17
  8 --- 18
  8 --- 19
  8 --- 20
  8 --- 21
  8 --- 22
  12 --- 23
  23 --- 24
  23 --- 25
  23 --- 26
  23 --- 27
  23 ---- 29
  23 --- 28
  24 --- 33
  24 --- 42
  24 --- 43
  25 --- 32
  25 --- 40
  25 --- 41
  26 --- 31
  26 --- 38
  26 --- 39
  27 --- 30
  27 --- 36
  27 --- 37
  29 --- 30
  29 --- 31
  29 --- 32
  29 --- 33
  29 --- 34
  29 --- 35
  29 --- 36
  29 --- 37
  29 --- 38
  29 --- 39
  29 --- 40
  29 --- 41
  29 --- 42
  29 --- 43
  12 <--x 44
```
