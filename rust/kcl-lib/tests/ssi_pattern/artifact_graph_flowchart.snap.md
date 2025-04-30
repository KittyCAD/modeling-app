```mermaid
flowchart LR
  subgraph path3 [Path]
    3["Path<br>[35, 69, 0]"]
    5["Segment<br>[75, 95, 0]"]
    6["Segment<br>[101, 126, 0]"]
    7["Segment<br>[132, 174, 0]"]
    8["Segment<br>[180, 202, 0]"]
    9["Segment<br>[208, 278, 0]"]
    10["Segment<br>[284, 291, 0]"]
    12[Solid2d]
  end
  subgraph path4 [Path]
    4["Path<br>[396, 440, 0]"]
    11["Segment<br>[396, 440, 0]"]
    13[Solid2d]
  end
  1["Plane<br>[12, 29, 0]"]
  2["StartSketchOnFace<br>[351, 390, 0]"]
  14["Sweep Extrusion<br>[306, 337, 0]"]
  15["Sweep Extrusion<br>[630, 651, 0]"]
  16["Sweep Extrusion<br>[630, 651, 0]"]
  17["Sweep Extrusion<br>[630, 651, 0]"]
  18["Sweep Extrusion<br>[630, 651, 0]"]
  19["Sweep Extrusion<br>[630, 651, 0]"]
  20["Sweep Extrusion<br>[630, 651, 0]"]
  21["Sweep Extrusion<br>[630, 651, 0]"]
  22["Sweep Extrusion<br>[630, 651, 0]"]
  23["Sweep Extrusion<br>[630, 651, 0]"]
  24["Sweep Extrusion<br>[630, 651, 0]"]
  25["Sweep Extrusion<br>[630, 651, 0]"]
  26["Sweep Extrusion<br>[630, 651, 0]"]
  27["Sweep Extrusion<br>[630, 651, 0]"]
  28["Sweep Extrusion<br>[630, 651, 0]"]
  29["Sweep Extrusion<br>[630, 651, 0]"]
  30["Sweep Extrusion<br>[630, 651, 0]"]
  31["Sweep Extrusion<br>[630, 651, 0]"]
  32["Sweep Extrusion<br>[630, 651, 0]"]
  33["Sweep Extrusion<br>[630, 651, 0]"]
  34["Sweep Extrusion<br>[630, 651, 0]"]
  35["Sweep Extrusion<br>[630, 651, 0]"]
  36["Sweep Extrusion<br>[630, 651, 0]"]
  37["Sweep Extrusion<br>[630, 651, 0]"]
  38["Sweep Extrusion<br>[630, 651, 0]"]
  39["Sweep Extrusion<br>[630, 651, 0]"]
  40["Sweep Extrusion<br>[630, 651, 0]"]
  41["Sweep Extrusion<br>[630, 651, 0]"]
  42["Sweep Extrusion<br>[630, 651, 0]"]
  43["Sweep Extrusion<br>[630, 651, 0]"]
  44["Sweep Extrusion<br>[630, 651, 0]"]
  45[Wall]
  46[Wall]
  47[Wall]
  48[Wall]
  49[Wall]
  50[Wall]
  51["Cap Start"]
  52["Cap End"]
  53["SweepEdge Opposite"]
  54["SweepEdge Opposite"]
  55["SweepEdge Opposite"]
  56["SweepEdge Opposite"]
  57["SweepEdge Opposite"]
  58["SweepEdge Opposite"]
  59["SweepEdge Adjacent"]
  60["SweepEdge Adjacent"]
  61["SweepEdge Adjacent"]
  62["SweepEdge Adjacent"]
  63["SweepEdge Adjacent"]
  64["SweepEdge Adjacent"]
  1 --- 3
  50 x--> 2
  3 --- 5
  3 --- 6
  3 --- 7
  3 --- 8
  3 --- 9
  3 --- 10
  3 --- 12
  3 ---- 14
  4 --- 11
  4 --- 13
  4 ---- 25
  50 --- 4
  5 --- 49
  5 x--> 51
  5 --- 56
  5 --- 61
  6 --- 47
  6 x--> 51
  6 --- 54
  6 --- 63
  7 --- 46
  7 x--> 51
  7 --- 57
  7 --- 60
  8 --- 48
  8 x--> 51
  8 --- 55
  8 --- 64
  9 --- 50
  9 x--> 51
  9 --- 58
  9 --- 62
  11 --- 45
  11 x--> 50
  11 --- 53
  11 --- 59
  14 --- 46
  14 --- 47
  14 --- 48
  14 --- 49
  14 --- 50
  14 --- 51
  14 --- 52
  14 --- 54
  14 --- 55
  14 --- 56
  14 --- 57
  14 --- 58
  14 --- 60
  14 --- 61
  14 --- 62
  14 --- 63
  14 --- 64
  25 --- 45
  25 --- 53
  25 --- 59
  53 <--x 45
  59 <--x 45
  53 <--x 46
  57 <--x 46
  60 <--x 46
  63 <--x 46
  54 <--x 47
  61 <--x 47
  63 <--x 47
  55 <--x 48
  60 <--x 48
  64 <--x 48
  56 <--x 49
  61 <--x 49
  62 <--x 49
  58 <--x 50
  62 <--x 50
  64 <--x 50
  54 <--x 52
  55 <--x 52
  56 <--x 52
  57 <--x 52
  58 <--x 52
```
