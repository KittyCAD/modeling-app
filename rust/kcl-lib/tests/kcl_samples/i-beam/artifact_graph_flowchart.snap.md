```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[475, 513, 0]"]
    3["Segment<br>[519, 550, 0]"]
    4["Segment<br>[556, 588, 0]"]
    5["Segment<br>[594, 644, 0]"]
    6["Segment<br>[650, 696, 0]"]
    7["Segment<br>[702, 724, 0]"]
  end
  1["Plane<br>[451, 469, 0]"]
  8["Sweep Extrusion<br>[778, 806, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
```
