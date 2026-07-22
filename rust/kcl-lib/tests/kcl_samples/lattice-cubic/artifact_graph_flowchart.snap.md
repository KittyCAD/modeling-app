```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[705, 1164, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    3["Segment<br>[733, 792, 0]"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    4["Segment<br>[802, 889, 0]"]
      %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path5 [Path]
    5["Path Region<br>[1178, 1216, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    6["Segment<br>[1178, 1216, 0]"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    7["Segment<br>[1178, 1216, 0]"]
      %% [ProgramBodyItem { index: 10 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path76 [Path]
    76["Path<br>[1926, 2145, 0]<br>Consumed: false"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    77["Segment<br>[1968, 2033, 0]"]
      %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path78 [Path]
    78["Path Region<br>[2159, 2199, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
    79["Segment<br>[2159, 2199, 0]"]
      %% [ProgramBodyItem { index: 20 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  end
  subgraph path139 [Path]
    139["Path Region<br>[2705, 2724, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    140["Segment<br>[2705, 2724, 0]"]
      %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  end
  subgraph path199 [Path]
    199["Path Region<br>[3109, 3128, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
    200["Segment<br>[3109, 3128, 0]"]
      %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  end
  1["Plane<br>[705, 1164, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  8["Sweep Revolve<br>[1235, 1280, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 11 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  9[Wall]
    %% face_code_ref=Missing NodePath
  10["Pattern Transform<br>[1396, 1513, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  11["Sweep Revolve<br>[1396, 1513, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  12[Wall]
    %% face_code_ref=Missing NodePath
  13["Sweep Revolve<br>[1396, 1513, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 14 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  14[Wall]
    %% face_code_ref=Missing NodePath
  15["Pattern Transform<br>[1540, 1660, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  16["Sweep Revolve<br>[1540, 1660, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  17[Wall]
    %% face_code_ref=Missing NodePath
  18["Sweep Revolve<br>[1540, 1660, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  19[Wall]
    %% face_code_ref=Missing NodePath
  20["Pattern Transform<br>[1540, 1660, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  21["Sweep Revolve<br>[1540, 1660, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  22[Wall]
    %% face_code_ref=Missing NodePath
  23["Sweep Revolve<br>[1540, 1660, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  24[Wall]
    %% face_code_ref=Missing NodePath
  25["Pattern Transform<br>[1540, 1660, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  26["Sweep Revolve<br>[1540, 1660, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  27[Wall]
    %% face_code_ref=Missing NodePath
  28["Sweep Revolve<br>[1540, 1660, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 15 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  29[Wall]
    %% face_code_ref=Missing NodePath
  30["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  31["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  32[Wall]
    %% face_code_ref=Missing NodePath
  33["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  34[Wall]
    %% face_code_ref=Missing NodePath
  35["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  36["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  37[Wall]
    %% face_code_ref=Missing NodePath
  38["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  39[Wall]
    %% face_code_ref=Missing NodePath
  40["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  41["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  42[Wall]
    %% face_code_ref=Missing NodePath
  43["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  44[Wall]
    %% face_code_ref=Missing NodePath
  45["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  46["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  47[Wall]
    %% face_code_ref=Missing NodePath
  48["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  49[Wall]
    %% face_code_ref=Missing NodePath
  50["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  51["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  52[Wall]
    %% face_code_ref=Missing NodePath
  53["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  54[Wall]
    %% face_code_ref=Missing NodePath
  55["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  56["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  57[Wall]
    %% face_code_ref=Missing NodePath
  58["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  59[Wall]
    %% face_code_ref=Missing NodePath
  60["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  61["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  62[Wall]
    %% face_code_ref=Missing NodePath
  63["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  64[Wall]
    %% face_code_ref=Missing NodePath
  65["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  66["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  67[Wall]
    %% face_code_ref=Missing NodePath
  68["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  69[Wall]
    %% face_code_ref=Missing NodePath
  70["Pattern Transform<br>[1692, 1817, 0]<br>Copies: 2<br>Faces: 2<br>Edges: 2"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  71["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  72[Wall]
    %% face_code_ref=Missing NodePath
  73["Sweep Revolve<br>[1692, 1817, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 16 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  74[Wall]
    %% face_code_ref=Missing NodePath
  75["Plane<br>[1870, 1911, 0]"]
    %% [ProgramBodyItem { index: 18 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  80["Sweep Extrusion<br>[2215, 2263, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 21 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  81[Wall]
    %% face_code_ref=Missing NodePath
  82["Cap Start"]
    %% face_code_ref=Missing NodePath
  83["Cap End"]
    %% face_code_ref=Missing NodePath
  84["SweepEdge Opposite"]
  85["SweepEdge Adjacent"]
  86["Pattern Transform<br>[2417, 2531, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  87["Sweep Extrusion<br>[2417, 2531, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  88[Wall]
    %% face_code_ref=Missing NodePath
  89["Cap Start"]
    %% face_code_ref=Missing NodePath
  90["Cap End"]
    %% face_code_ref=Missing NodePath
  91["SweepEdge Opposite"]
  92["SweepEdge Adjacent"]
  93["Sweep Extrusion<br>[2417, 2531, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 24 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  94[Wall]
    %% face_code_ref=Missing NodePath
  95["Cap Start"]
    %% face_code_ref=Missing NodePath
  96["Cap End"]
    %% face_code_ref=Missing NodePath
  97["SweepEdge Opposite"]
  98["SweepEdge Adjacent"]
  99["Pattern Transform<br>[2563, 2688, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  100["Sweep Extrusion<br>[2563, 2688, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  101[Wall]
    %% face_code_ref=Missing NodePath
  102["Cap Start"]
    %% face_code_ref=Missing NodePath
  103["Cap End"]
    %% face_code_ref=Missing NodePath
  104["SweepEdge Opposite"]
  105["SweepEdge Adjacent"]
  106["Sweep Extrusion<br>[2563, 2688, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  107[Wall]
    %% face_code_ref=Missing NodePath
  108["Cap Start"]
    %% face_code_ref=Missing NodePath
  109["Cap End"]
    %% face_code_ref=Missing NodePath
  110["SweepEdge Opposite"]
  111["SweepEdge Adjacent"]
  112["Pattern Transform<br>[2563, 2688, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  113["Sweep Extrusion<br>[2563, 2688, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  114[Wall]
    %% face_code_ref=Missing NodePath
  115["Cap Start"]
    %% face_code_ref=Missing NodePath
  116["Cap End"]
    %% face_code_ref=Missing NodePath
  117["SweepEdge Opposite"]
  118["SweepEdge Adjacent"]
  119["Sweep Extrusion<br>[2563, 2688, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  120[Wall]
    %% face_code_ref=Missing NodePath
  121["Cap Start"]
    %% face_code_ref=Missing NodePath
  122["Cap End"]
    %% face_code_ref=Missing NodePath
  123["SweepEdge Opposite"]
  124["SweepEdge Adjacent"]
  125["Pattern Transform<br>[2563, 2688, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  126["Sweep Extrusion<br>[2563, 2688, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  127[Wall]
    %% face_code_ref=Missing NodePath
  128["Cap Start"]
    %% face_code_ref=Missing NodePath
  129["Cap End"]
    %% face_code_ref=Missing NodePath
  130["SweepEdge Opposite"]
  131["SweepEdge Adjacent"]
  132["Sweep Extrusion<br>[2563, 2688, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 25 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  133[Wall]
    %% face_code_ref=Missing NodePath
  134["Cap Start"]
    %% face_code_ref=Missing NodePath
  135["Cap End"]
    %% face_code_ref=Missing NodePath
  136["SweepEdge Opposite"]
  137["SweepEdge Adjacent"]
  138["Sweep Extrusion<br>[2705, 2724, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 26 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  141[Wall]
    %% face_code_ref=Missing NodePath
  142["Cap Start"]
    %% face_code_ref=Missing NodePath
  143["Cap End"]
    %% face_code_ref=Missing NodePath
  144["SweepEdge Opposite"]
  145["SweepEdge Adjacent"]
  146["Pattern Transform<br>[2839, 2953, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  147["Sweep Extrusion<br>[2839, 2953, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  148[Wall]
    %% face_code_ref=Missing NodePath
  149["Cap Start"]
    %% face_code_ref=Missing NodePath
  150["Cap End"]
    %% face_code_ref=Missing NodePath
  151["SweepEdge Opposite"]
  152["SweepEdge Adjacent"]
  153["Sweep Extrusion<br>[2839, 2953, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 27 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  154[Wall]
    %% face_code_ref=Missing NodePath
  155["Cap Start"]
    %% face_code_ref=Missing NodePath
  156["Cap End"]
    %% face_code_ref=Missing NodePath
  157["SweepEdge Opposite"]
  158["SweepEdge Adjacent"]
  159["Pattern Transform<br>[2967, 3092, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  160["Sweep Extrusion<br>[2967, 3092, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  161[Wall]
    %% face_code_ref=Missing NodePath
  162["Cap Start"]
    %% face_code_ref=Missing NodePath
  163["Cap End"]
    %% face_code_ref=Missing NodePath
  164["SweepEdge Opposite"]
  165["SweepEdge Adjacent"]
  166["Sweep Extrusion<br>[2967, 3092, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  167[Wall]
    %% face_code_ref=Missing NodePath
  168["Cap Start"]
    %% face_code_ref=Missing NodePath
  169["Cap End"]
    %% face_code_ref=Missing NodePath
  170["SweepEdge Opposite"]
  171["SweepEdge Adjacent"]
  172["Pattern Transform<br>[2967, 3092, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  173["Sweep Extrusion<br>[2967, 3092, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  174[Wall]
    %% face_code_ref=Missing NodePath
  175["Cap Start"]
    %% face_code_ref=Missing NodePath
  176["Cap End"]
    %% face_code_ref=Missing NodePath
  177["SweepEdge Opposite"]
  178["SweepEdge Adjacent"]
  179["Sweep Extrusion<br>[2967, 3092, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  180[Wall]
    %% face_code_ref=Missing NodePath
  181["Cap Start"]
    %% face_code_ref=Missing NodePath
  182["Cap End"]
    %% face_code_ref=Missing NodePath
  183["SweepEdge Opposite"]
  184["SweepEdge Adjacent"]
  185["Pattern Transform<br>[2967, 3092, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  186["Sweep Extrusion<br>[2967, 3092, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  187[Wall]
    %% face_code_ref=Missing NodePath
  188["Cap Start"]
    %% face_code_ref=Missing NodePath
  189["Cap End"]
    %% face_code_ref=Missing NodePath
  190["SweepEdge Opposite"]
  191["SweepEdge Adjacent"]
  192["Sweep Extrusion<br>[2967, 3092, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 28 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  193[Wall]
    %% face_code_ref=Missing NodePath
  194["Cap Start"]
    %% face_code_ref=Missing NodePath
  195["Cap End"]
    %% face_code_ref=Missing NodePath
  196["SweepEdge Opposite"]
  197["SweepEdge Adjacent"]
  198["Sweep Extrusion<br>[3109, 3128, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 29 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  201[Wall]
    %% face_code_ref=Missing NodePath
  202["Cap Start"]
    %% face_code_ref=Missing NodePath
  203["Cap End"]
    %% face_code_ref=Missing NodePath
  204["SweepEdge Opposite"]
  205["SweepEdge Adjacent"]
  206["Pattern Transform<br>[3258, 3372, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  207["Sweep Extrusion<br>[3258, 3372, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  208[Wall]
    %% face_code_ref=Missing NodePath
  209["Cap Start"]
    %% face_code_ref=Missing NodePath
  210["Cap End"]
    %% face_code_ref=Missing NodePath
  211["SweepEdge Opposite"]
  212["SweepEdge Adjacent"]
  213["Sweep Extrusion<br>[3258, 3372, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 30 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  214[Wall]
    %% face_code_ref=Missing NodePath
  215["Cap Start"]
    %% face_code_ref=Missing NodePath
  216["Cap End"]
    %% face_code_ref=Missing NodePath
  217["SweepEdge Opposite"]
  218["SweepEdge Adjacent"]
  219["Pattern Transform<br>[3386, 3520, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  220["Sweep Extrusion<br>[3386, 3520, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  221[Wall]
    %% face_code_ref=Missing NodePath
  222["Cap Start"]
    %% face_code_ref=Missing NodePath
  223["Cap End"]
    %% face_code_ref=Missing NodePath
  224["SweepEdge Opposite"]
  225["SweepEdge Adjacent"]
  226["Sweep Extrusion<br>[3386, 3520, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  227[Wall]
    %% face_code_ref=Missing NodePath
  228["Cap Start"]
    %% face_code_ref=Missing NodePath
  229["Cap End"]
    %% face_code_ref=Missing NodePath
  230["SweepEdge Opposite"]
  231["SweepEdge Adjacent"]
  232["Pattern Transform<br>[3386, 3520, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  233["Sweep Extrusion<br>[3386, 3520, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  234[Wall]
    %% face_code_ref=Missing NodePath
  235["Cap Start"]
    %% face_code_ref=Missing NodePath
  236["Cap End"]
    %% face_code_ref=Missing NodePath
  237["SweepEdge Opposite"]
  238["SweepEdge Adjacent"]
  239["Sweep Extrusion<br>[3386, 3520, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  240[Wall]
    %% face_code_ref=Missing NodePath
  241["Cap Start"]
    %% face_code_ref=Missing NodePath
  242["Cap End"]
    %% face_code_ref=Missing NodePath
  243["SweepEdge Opposite"]
  244["SweepEdge Adjacent"]
  245["Pattern Transform<br>[3386, 3520, 0]<br>Copies: 2<br>Faces: 6<br>Edges: 6"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  246["Sweep Extrusion<br>[3386, 3520, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  247[Wall]
    %% face_code_ref=Missing NodePath
  248["Cap Start"]
    %% face_code_ref=Missing NodePath
  249["Cap End"]
    %% face_code_ref=Missing NodePath
  250["SweepEdge Opposite"]
  251["SweepEdge Adjacent"]
  252["Sweep Extrusion<br>[3386, 3520, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 31 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  253[Wall]
    %% face_code_ref=Missing NodePath
  254["Cap Start"]
    %% face_code_ref=Missing NodePath
  255["Cap End"]
    %% face_code_ref=Missing NodePath
  256["SweepEdge Opposite"]
  257["SweepEdge Adjacent"]
  258["SketchBlock<br>[705, 1164, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  259["SketchBlockConstraint Coincident<br>[892, 927, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  260["SketchBlockConstraint Coincident<br>[930, 965, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 3 }, ExpressionStatementExpr]
  261["SketchBlockConstraint Coincident<br>[968, 1001, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 4 }, ExpressionStatementExpr]
  262["SketchBlockConstraint Coincident<br>[1004, 1036, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 5 }, ExpressionStatementExpr]
  263["SketchBlockConstraint Vertical<br>[1039, 1054, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 6 }, ExpressionStatementExpr]
  264["SketchBlockConstraint Distance<br>[1057, 1121, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 7 }, ExpressionStatementExpr]
  265["SketchBlockConstraint Radius<br>[1124, 1162, 0]"]
    %% [ProgramBodyItem { index: 9 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 8 }, ExpressionStatementExpr]
  266["SketchBlock<br>[1926, 2145, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  267["SketchBlockConstraint Coincident<br>[2036, 2072, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 1 }, ExpressionStatementExpr]
  268["SketchBlockConstraint Distance<br>[2075, 2143, 0]"]
    %% [ProgramBodyItem { index: 19 }, VariableDeclarationDeclaration, VariableDeclarationInit, SketchBlockBody, SketchBlockBodyItem { index: 2 }, ExpressionStatementExpr]
  1 --- 2
  1 <--x 5
  1 <--x 258
  2 --- 3
  2 --- 4
  2 <--x 5
  258 --- 2
  3 <--x 6
  4 <--x 7
  5 <--x 6
  5 <--x 7
  5 ---- 8
  5 --- 10
  5 <---x 11
  5 <---x 13
  5 --- 15
  5 <---x 16
  5 <---x 18
  5 <---x 21
  5 <---x 23
  5 <---x 26
  5 <---x 28
  5 --- 30
  5 <---x 31
  5 <---x 33
  5 <---x 36
  5 <---x 38
  5 <---x 41
  5 <---x 43
  5 <---x 46
  5 <---x 48
  5 <---x 51
  5 <---x 53
  5 <---x 56
  5 <---x 58
  5 <---x 61
  5 <---x 63
  5 <---x 66
  5 <---x 68
  5 <---x 71
  5 <---x 73
  8 <--x 7
  7 --- 9
  8 --- 9
  8 x--> 10
  8 x--> 15
  8 x--> 30
  10 x--> 11
  10 x--> 12
  10 x--> 13
  10 x--> 14
  11 --- 12
  11 x--> 15
  11 --- 20
  11 x--> 30
  11 --- 45
  13 --- 14
  13 x--> 15
  13 --- 25
  13 x--> 30
  13 --- 60
  15 x--> 16
  15 x--> 17
  15 x--> 18
  15 x--> 19
  16 --- 17
  16 x--> 30
  16 --- 35
  18 --- 19
  18 x--> 30
  18 --- 40
  20 x--> 21
  20 x--> 22
  20 x--> 23
  20 x--> 24
  21 --- 22
  21 x--> 30
  21 --- 50
  23 --- 24
  23 x--> 30
  23 --- 55
  25 x--> 26
  25 x--> 27
  25 x--> 28
  25 x--> 29
  26 --- 27
  26 x--> 30
  26 --- 65
  28 --- 29
  28 x--> 30
  28 --- 70
  30 x--> 31
  30 x--> 32
  30 x--> 33
  30 x--> 34
  31 --- 32
  33 --- 34
  35 x--> 36
  35 x--> 37
  35 x--> 38
  35 x--> 39
  36 --- 37
  38 --- 39
  40 x--> 41
  40 x--> 42
  40 x--> 43
  40 x--> 44
  41 --- 42
  43 --- 44
  45 x--> 46
  45 x--> 47
  45 x--> 48
  45 x--> 49
  46 --- 47
  48 --- 49
  50 x--> 51
  50 x--> 52
  50 x--> 53
  50 x--> 54
  51 --- 52
  53 --- 54
  55 x--> 56
  55 x--> 57
  55 x--> 58
  55 x--> 59
  56 --- 57
  58 --- 59
  60 x--> 61
  60 x--> 62
  60 x--> 63
  60 x--> 64
  61 --- 62
  63 --- 64
  65 x--> 66
  65 x--> 67
  65 x--> 68
  65 x--> 69
  66 --- 67
  68 --- 69
  70 x--> 71
  70 x--> 72
  70 x--> 73
  70 x--> 74
  71 --- 72
  73 --- 74
  75 --- 76
  75 <--x 78
  75 <--x 139
  75 <--x 199
  75 <--x 266
  76 --- 77
  76 <--x 78
  76 <--x 139
  76 <--x 199
  266 --- 76
  77 <--x 79
  77 <--x 140
  77 <--x 200
  78 <--x 79
  78 ---- 80
  78 --- 86
  78 <---x 87
  78 <---x 93
  78 --- 99
  78 <---x 100
  78 <---x 106
  78 <---x 113
  78 <---x 119
  78 <---x 126
  78 <---x 132
  79 --- 81
  79 x--> 83
  79 --- 84
  79 --- 85
  79 <--x 88
  79 <--x 91
  79 <--x 92
  79 <--x 94
  79 <--x 97
  79 <--x 98
  79 <--x 101
  79 <--x 104
  79 <--x 105
  79 <--x 107
  79 <--x 110
  79 <--x 111
  79 <--x 114
  79 <--x 117
  79 <--x 118
  79 <--x 120
  79 <--x 123
  79 <--x 124
  79 <--x 127
  79 <--x 130
  79 <--x 131
  79 <--x 133
  79 <--x 136
  79 <--x 137
  80 --- 81
  80 --- 82
  80 --- 83
  80 --- 84
  80 --- 85
  80 x--> 86
  80 x--> 99
  81 --- 84
  81 --- 85
  84 <--x 82
  86 x--> 87
  86 x--> 88
  86 x--> 89
  86 x--> 90
  86 x--> 91
  86 x--> 92
  86 x--> 93
  86 x--> 94
  86 x--> 95
  86 x--> 96
  86 x--> 97
  86 x--> 98
  87 --- 88
  87 --- 89
  87 --- 90
  87 --- 91
  87 --- 92
  87 x--> 99
  87 --- 112
  88 --- 91
  88 --- 92
  91 <--x 89
  93 --- 94
  93 --- 95
  93 --- 96
  93 --- 97
  93 --- 98
  93 x--> 99
  93 --- 125
  94 --- 97
  94 --- 98
  97 <--x 95
  99 x--> 100
  99 x--> 101
  99 x--> 102
  99 x--> 103
  99 x--> 104
  99 x--> 105
  99 x--> 106
  99 x--> 107
  99 x--> 108
  99 x--> 109
  99 x--> 110
  99 x--> 111
  100 --- 101
  100 --- 102
  100 --- 103
  100 --- 104
  100 --- 105
  101 --- 104
  101 --- 105
  104 <--x 102
  106 --- 107
  106 --- 108
  106 --- 109
  106 --- 110
  106 --- 111
  107 --- 110
  107 --- 111
  110 <--x 108
  112 x--> 113
  112 x--> 114
  112 x--> 115
  112 x--> 116
  112 x--> 117
  112 x--> 118
  112 x--> 119
  112 x--> 120
  112 x--> 121
  112 x--> 122
  112 x--> 123
  112 x--> 124
  113 --- 114
  113 --- 115
  113 --- 116
  113 --- 117
  113 --- 118
  114 --- 117
  114 --- 118
  117 <--x 115
  119 --- 120
  119 --- 121
  119 --- 122
  119 --- 123
  119 --- 124
  120 --- 123
  120 --- 124
  123 <--x 121
  125 x--> 126
  125 x--> 127
  125 x--> 128
  125 x--> 129
  125 x--> 130
  125 x--> 131
  125 x--> 132
  125 x--> 133
  125 x--> 134
  125 x--> 135
  125 x--> 136
  125 x--> 137
  126 --- 127
  126 --- 128
  126 --- 129
  126 --- 130
  126 --- 131
  127 --- 130
  127 --- 131
  130 <--x 128
  132 --- 133
  132 --- 134
  132 --- 135
  132 --- 136
  132 --- 137
  133 --- 136
  133 --- 137
  136 <--x 134
  139 ---- 138
  138 --- 141
  138 --- 142
  138 --- 143
  138 --- 144
  138 --- 145
  138 x--> 146
  138 x--> 159
  139 <--x 140
  139 --- 146
  139 <---x 147
  139 <---x 153
  139 --- 159
  139 <---x 160
  139 <---x 166
  139 <---x 173
  139 <---x 179
  139 <---x 186
  139 <---x 192
  140 --- 141
  140 x--> 143
  140 --- 144
  140 --- 145
  140 <--x 148
  140 <--x 151
  140 <--x 152
  140 <--x 154
  140 <--x 157
  140 <--x 158
  140 <--x 161
  140 <--x 164
  140 <--x 165
  140 <--x 167
  140 <--x 170
  140 <--x 171
  140 <--x 174
  140 <--x 177
  140 <--x 178
  140 <--x 180
  140 <--x 183
  140 <--x 184
  140 <--x 187
  140 <--x 190
  140 <--x 191
  140 <--x 193
  140 <--x 196
  140 <--x 197
  141 --- 144
  141 --- 145
  144 <--x 142
  146 x--> 147
  146 x--> 148
  146 x--> 149
  146 x--> 150
  146 x--> 151
  146 x--> 152
  146 x--> 153
  146 x--> 154
  146 x--> 155
  146 x--> 156
  146 x--> 157
  146 x--> 158
  147 --- 148
  147 --- 149
  147 --- 150
  147 --- 151
  147 --- 152
  147 x--> 159
  147 --- 172
  148 --- 151
  148 --- 152
  151 <--x 149
  153 --- 154
  153 --- 155
  153 --- 156
  153 --- 157
  153 --- 158
  153 x--> 159
  153 --- 185
  154 --- 157
  154 --- 158
  157 <--x 155
  159 x--> 160
  159 x--> 161
  159 x--> 162
  159 x--> 163
  159 x--> 164
  159 x--> 165
  159 x--> 166
  159 x--> 167
  159 x--> 168
  159 x--> 169
  159 x--> 170
  159 x--> 171
  160 --- 161
  160 --- 162
  160 --- 163
  160 --- 164
  160 --- 165
  161 --- 164
  161 --- 165
  164 <--x 162
  166 --- 167
  166 --- 168
  166 --- 169
  166 --- 170
  166 --- 171
  167 --- 170
  167 --- 171
  170 <--x 168
  172 x--> 173
  172 x--> 174
  172 x--> 175
  172 x--> 176
  172 x--> 177
  172 x--> 178
  172 x--> 179
  172 x--> 180
  172 x--> 181
  172 x--> 182
  172 x--> 183
  172 x--> 184
  173 --- 174
  173 --- 175
  173 --- 176
  173 --- 177
  173 --- 178
  174 --- 177
  174 --- 178
  177 <--x 175
  179 --- 180
  179 --- 181
  179 --- 182
  179 --- 183
  179 --- 184
  180 --- 183
  180 --- 184
  183 <--x 181
  185 x--> 186
  185 x--> 187
  185 x--> 188
  185 x--> 189
  185 x--> 190
  185 x--> 191
  185 x--> 192
  185 x--> 193
  185 x--> 194
  185 x--> 195
  185 x--> 196
  185 x--> 197
  186 --- 187
  186 --- 188
  186 --- 189
  186 --- 190
  186 --- 191
  187 --- 190
  187 --- 191
  190 <--x 188
  192 --- 193
  192 --- 194
  192 --- 195
  192 --- 196
  192 --- 197
  193 --- 196
  193 --- 197
  196 <--x 194
  199 ---- 198
  198 --- 201
  198 --- 202
  198 --- 203
  198 --- 204
  198 --- 205
  198 x--> 206
  198 x--> 219
  199 <--x 200
  199 --- 206
  199 <---x 207
  199 <---x 213
  199 --- 219
  199 <---x 220
  199 <---x 226
  199 <---x 233
  199 <---x 239
  199 <---x 246
  199 <---x 252
  200 --- 201
  200 x--> 203
  200 --- 204
  200 --- 205
  200 <--x 208
  200 <--x 211
  200 <--x 212
  200 <--x 214
  200 <--x 217
  200 <--x 218
  200 <--x 221
  200 <--x 224
  200 <--x 225
  200 <--x 227
  200 <--x 230
  200 <--x 231
  200 <--x 234
  200 <--x 237
  200 <--x 238
  200 <--x 240
  200 <--x 243
  200 <--x 244
  200 <--x 247
  200 <--x 250
  200 <--x 251
  200 <--x 253
  200 <--x 256
  200 <--x 257
  201 --- 204
  201 --- 205
  204 <--x 202
  206 x--> 207
  206 x--> 208
  206 x--> 209
  206 x--> 210
  206 x--> 211
  206 x--> 212
  206 x--> 213
  206 x--> 214
  206 x--> 215
  206 x--> 216
  206 x--> 217
  206 x--> 218
  207 --- 208
  207 --- 209
  207 --- 210
  207 --- 211
  207 --- 212
  207 x--> 219
  207 --- 232
  208 --- 211
  208 --- 212
  211 <--x 209
  213 --- 214
  213 --- 215
  213 --- 216
  213 --- 217
  213 --- 218
  213 x--> 219
  213 --- 245
  214 --- 217
  214 --- 218
  217 <--x 215
  219 x--> 220
  219 x--> 221
  219 x--> 222
  219 x--> 223
  219 x--> 224
  219 x--> 225
  219 x--> 226
  219 x--> 227
  219 x--> 228
  219 x--> 229
  219 x--> 230
  219 x--> 231
  220 --- 221
  220 --- 222
  220 --- 223
  220 --- 224
  220 --- 225
  221 --- 224
  221 --- 225
  224 <--x 222
  226 --- 227
  226 --- 228
  226 --- 229
  226 --- 230
  226 --- 231
  227 --- 230
  227 --- 231
  230 <--x 228
  232 x--> 233
  232 x--> 234
  232 x--> 235
  232 x--> 236
  232 x--> 237
  232 x--> 238
  232 x--> 239
  232 x--> 240
  232 x--> 241
  232 x--> 242
  232 x--> 243
  232 x--> 244
  233 --- 234
  233 --- 235
  233 --- 236
  233 --- 237
  233 --- 238
  234 --- 237
  234 --- 238
  237 <--x 235
  239 --- 240
  239 --- 241
  239 --- 242
  239 --- 243
  239 --- 244
  240 --- 243
  240 --- 244
  243 <--x 241
  245 x--> 246
  245 x--> 247
  245 x--> 248
  245 x--> 249
  245 x--> 250
  245 x--> 251
  245 x--> 252
  245 x--> 253
  245 x--> 254
  245 x--> 255
  245 x--> 256
  245 x--> 257
  246 --- 247
  246 --- 248
  246 --- 249
  246 --- 250
  246 --- 251
  247 --- 250
  247 --- 251
  250 <--x 248
  252 --- 253
  252 --- 254
  252 --- 255
  252 --- 256
  252 --- 257
  253 --- 256
  253 --- 257
  256 <--x 254
```
