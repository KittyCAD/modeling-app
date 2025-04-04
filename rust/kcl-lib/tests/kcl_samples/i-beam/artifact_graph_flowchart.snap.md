```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[462, 500, 0]"]
    3["Segment<br>[506, 537, 0]"]
    4["Segment<br>[543, 575, 0]"]
    5["Segment<br>[581, 631, 0]"]
    6["Segment<br>[637, 691, 0]"]
    7["Segment<br>[697, 719, 0]"]
  end
  1["Plane<br>[438, 456, 0]"]
  8["Sweep Extrusion<br>[773, 801, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
```
