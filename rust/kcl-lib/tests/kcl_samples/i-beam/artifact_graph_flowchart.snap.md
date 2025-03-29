```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[469, 507, 0]"]
    3["Segment<br>[513, 544, 0]"]
    4["Segment<br>[550, 582, 0]"]
    5["Segment<br>[588, 638, 0]"]
    6["Segment<br>[644, 698, 0]"]
    7["Segment<br>[704, 726, 0]"]
  end
  1["Plane<br>[445, 463, 0]"]
  8["Sweep Extrusion<br>[780, 808, 0]"]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
```
