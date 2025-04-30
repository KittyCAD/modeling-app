```mermaid
flowchart LR
  subgraph path5 [Path]
    5["Path<br>[193, 218, 0]"]
    6["Segment<br>[224, 249, 0]"]
  end
  1["Plane<br>[17, 47, 0]"]
  2["Plane<br>[65, 96, 0]"]
  3["Plane<br>[114, 144, 0]"]
  4["StartSketchOnPlane<br>[158, 187, 0]"]
  1 <--x 4
  1 --- 5
  5 --- 6
```
