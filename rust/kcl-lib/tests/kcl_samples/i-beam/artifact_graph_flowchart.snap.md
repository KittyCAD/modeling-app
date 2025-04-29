```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[457, 495, 0]"]
    3["Segment<br>[501, 532, 0]"]
    4["Segment<br>[538, 570, 0]"]
    5["Segment<br>[576, 626, 0]"]
    6["Segment<br>[632, 678, 0]"]
    7["Segment<br>[684, 706, 0]"]
  end
  1["Plane<br>[433, 451, 0]"]
  8["Sweep Extrusion<br>[760, 788, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
```
