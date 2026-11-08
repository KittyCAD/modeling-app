```mermaid
flowchart LR
  subgraph path2 [Path]
    2["Path<br>[39, 64, 0]<br>Consumed: true"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 1 }]
    3["Segment<br>[70, 88, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 2 }]
    4["Segment<br>[94, 112, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 3 }]
    5["Segment<br>[118, 137, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 4 }]
    6["Segment<br>[143, 151, 0]"]
      %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 5 }]
    7[Solid2d]
  end
  1["Plane<br>[16, 33, 0]"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 0 }]
  8["Sweep Extrusion<br>[157, 176, 0]<br>Consumed: false"]
    %% [ProgramBodyItem { index: 0 }, VariableDeclarationDeclaration, VariableDeclarationInit, PipeBodyItem { index: 6 }]
  9[Wall]
    %% face_code_ref=Missing NodePath
  10[Wall]
    %% face_code_ref=Missing NodePath
  11[Wall]
    %% face_code_ref=Missing NodePath
  12[Wall]
    %% face_code_ref=Missing NodePath
  13["Cap Start"]
    %% face_code_ref=Missing NodePath
  14["Cap End"]
    %% face_code_ref=Missing NodePath
  15["SweepEdge Opposite"]
  16["SweepEdge Adjacent"]
  17["SweepEdge Opposite"]
  18["SweepEdge Adjacent"]
  19["SweepEdge Opposite"]
  20["SweepEdge Adjacent"]
  21["SweepEdge Opposite"]
  22["SweepEdge Adjacent"]
  23["Pattern Transform<br>[187, 275, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  24["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  25["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  26["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  27["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  28["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  29["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  30["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  31["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  32["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  33["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  34["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  35["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  36["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  37["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  38["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  39["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  40["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  41["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  42["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  43["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  44["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  45["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  46["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  47["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  48["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  49["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  50["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  51["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  52["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  53["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  54["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  55["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  56["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  57["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  58["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  59["PrimitiveFace<br>[187, 275, 0]"]
    %% [ProgramBodyItem { index: 1 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  60["Pattern Transform<br>[286, 367, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  61["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  62["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  63["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  64["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  65["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  66["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  67["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  68["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  69["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  70["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  71["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  72["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  73["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  74["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  75["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  76["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  77["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  78["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  79["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  80["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  81["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  82["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  83["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  84["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  85["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  86["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  87["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  88["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  89["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  90["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  91["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  92["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  93["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  94["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  95["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  96["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  97["Pattern Transform<br>[286, 367, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  98["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  99["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  100["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  101["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  102["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  103["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  104["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  105["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  106["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  107["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  108["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  109["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  110["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  111["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  112["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  113["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  114["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  115["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  116["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  117["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  118["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  119["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  120["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  121["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  122["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  123["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  124["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  125["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  126["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  127["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  128["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  129["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  130["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  131["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  132["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  133["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  134["Pattern Transform<br>[286, 367, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  135["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  136["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  137["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  138["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  139["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  140["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  141["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  142["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  143["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  144["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  145["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  146["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  147["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  148["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  149["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  150["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  151["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  152["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  153["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  154["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  155["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  156["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  157["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  158["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  159["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  160["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  161["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  162["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  163["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  164["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  165["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  166["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  167["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  168["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  169["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  170["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  171["Pattern Transform<br>[286, 367, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  172["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  173["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  174["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  175["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  176["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  177["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  178["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  179["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  180["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  181["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  182["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  183["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  184["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  185["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  186["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  187["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  188["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  189["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  190["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  191["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  192["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  193["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  194["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  195["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  196["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  197["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  198["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  199["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  200["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  201["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  202["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  203["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  204["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  205["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  206["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  207["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  208["Pattern Transform<br>[286, 367, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  209["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  210["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  211["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  212["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  213["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  214["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  215["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  216["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  217["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  218["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  219["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  220["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  221["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  222["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  223["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  224["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  225["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  226["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  227["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  228["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  229["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  230["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  231["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  232["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  233["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  234["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  235["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  236["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  237["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  238["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  239["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  240["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  241["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  242["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  243["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  244["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  245["Pattern Transform<br>[286, 367, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  246["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  247["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  248["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  249["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  250["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  251["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  252["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  253["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  254["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  255["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  256["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  257["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  258["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  259["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  260["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  261["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  262["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  263["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  264["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  265["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  266["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  267["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  268["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  269["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  270["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  271["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  272["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  273["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  274["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  275["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  276["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  277["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  278["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  279["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  280["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  281["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  282["Pattern Transform<br>[286, 367, 0]<br>Copies: 6<br>Faces: 36<br>Edges: 72"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  283["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  284["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  285["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  286["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  287["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  288["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  289["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  290["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  291["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  292["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  293["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  294["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  295["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  296["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  297["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  298["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  299["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  300["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  301["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  302["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  303["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  304["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  305["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  306["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  307["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  308["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  309["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  310["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  311["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  312["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  313["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  314["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  315["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  316["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  317["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  318["PrimitiveFace<br>[286, 367, 0]"]
    %% [ProgramBodyItem { index: 2 }, VariableDeclarationDeclaration, VariableDeclarationInit]
  1 --- 2
  2 --- 3
  2 --- 4
  2 --- 5
  2 --- 6
  2 --- 7
  2 ---- 8
  2 --- 23
  2 --- 60
  3 --- 12
  3 x--> 13
  3 --- 21
  3 --- 22
  4 --- 11
  4 x--> 13
  4 --- 19
  4 --- 20
  5 --- 10
  5 x--> 13
  5 --- 17
  5 --- 18
  6 --- 9
  6 x--> 13
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
  8 x--> 23
  8 x--> 60
  9 --- 15
  9 --- 16
  18 <--x 9
  10 --- 17
  10 --- 18
  20 <--x 10
  11 --- 19
  11 --- 20
  22 <--x 11
  16 <--x 12
  12 --- 21
  12 --- 22
  15 <--x 14
  17 <--x 14
  19 <--x 14
  21 <--x 14
  23 x--> 24
  23 x--> 25
  23 x--> 26
  23 x--> 27
  23 x--> 28
  23 x--> 29
  23 x--> 30
  23 x--> 31
  23 x--> 32
  23 x--> 33
  23 x--> 34
  23 x--> 35
  23 x--> 36
  23 x--> 37
  23 x--> 38
  23 x--> 39
  23 x--> 40
  23 x--> 41
  23 x--> 42
  23 x--> 43
  23 x--> 44
  23 x--> 45
  23 x--> 46
  23 x--> 47
  23 x--> 48
  23 x--> 49
  23 x--> 50
  23 x--> 51
  23 x--> 52
  23 x--> 53
  23 x--> 54
  23 x--> 55
  23 x--> 56
  23 x--> 57
  23 x--> 58
  23 x--> 59
  60 x--> 61
  60 x--> 62
  60 x--> 63
  60 x--> 64
  60 x--> 65
  60 x--> 66
  60 x--> 67
  60 x--> 68
  60 x--> 69
  60 x--> 70
  60 x--> 71
  60 x--> 72
  60 x--> 73
  60 x--> 74
  60 x--> 75
  60 x--> 76
  60 x--> 77
  60 x--> 78
  60 x--> 79
  60 x--> 80
  60 x--> 81
  60 x--> 82
  60 x--> 83
  60 x--> 84
  60 x--> 85
  60 x--> 86
  60 x--> 87
  60 x--> 88
  60 x--> 89
  60 x--> 90
  60 x--> 91
  60 x--> 92
  60 x--> 93
  60 x--> 94
  60 x--> 95
  60 x--> 96
  97 x--> 98
  97 x--> 99
  97 x--> 100
  97 x--> 101
  97 x--> 102
  97 x--> 103
  97 x--> 104
  97 x--> 105
  97 x--> 106
  97 x--> 107
  97 x--> 108
  97 x--> 109
  97 x--> 110
  97 x--> 111
  97 x--> 112
  97 x--> 113
  97 x--> 114
  97 x--> 115
  97 x--> 116
  97 x--> 117
  97 x--> 118
  97 x--> 119
  97 x--> 120
  97 x--> 121
  97 x--> 122
  97 x--> 123
  97 x--> 124
  97 x--> 125
  97 x--> 126
  97 x--> 127
  97 x--> 128
  97 x--> 129
  97 x--> 130
  97 x--> 131
  97 x--> 132
  97 x--> 133
  134 x--> 135
  134 x--> 136
  134 x--> 137
  134 x--> 138
  134 x--> 139
  134 x--> 140
  134 x--> 141
  134 x--> 142
  134 x--> 143
  134 x--> 144
  134 x--> 145
  134 x--> 146
  134 x--> 147
  134 x--> 148
  134 x--> 149
  134 x--> 150
  134 x--> 151
  134 x--> 152
  134 x--> 153
  134 x--> 154
  134 x--> 155
  134 x--> 156
  134 x--> 157
  134 x--> 158
  134 x--> 159
  134 x--> 160
  134 x--> 161
  134 x--> 162
  134 x--> 163
  134 x--> 164
  134 x--> 165
  134 x--> 166
  134 x--> 167
  134 x--> 168
  134 x--> 169
  134 x--> 170
  171 x--> 172
  171 x--> 173
  171 x--> 174
  171 x--> 175
  171 x--> 176
  171 x--> 177
  171 x--> 178
  171 x--> 179
  171 x--> 180
  171 x--> 181
  171 x--> 182
  171 x--> 183
  171 x--> 184
  171 x--> 185
  171 x--> 186
  171 x--> 187
  171 x--> 188
  171 x--> 189
  171 x--> 190
  171 x--> 191
  171 x--> 192
  171 x--> 193
  171 x--> 194
  171 x--> 195
  171 x--> 196
  171 x--> 197
  171 x--> 198
  171 x--> 199
  171 x--> 200
  171 x--> 201
  171 x--> 202
  171 x--> 203
  171 x--> 204
  171 x--> 205
  171 x--> 206
  171 x--> 207
  208 x--> 209
  208 x--> 210
  208 x--> 211
  208 x--> 212
  208 x--> 213
  208 x--> 214
  208 x--> 215
  208 x--> 216
  208 x--> 217
  208 x--> 218
  208 x--> 219
  208 x--> 220
  208 x--> 221
  208 x--> 222
  208 x--> 223
  208 x--> 224
  208 x--> 225
  208 x--> 226
  208 x--> 227
  208 x--> 228
  208 x--> 229
  208 x--> 230
  208 x--> 231
  208 x--> 232
  208 x--> 233
  208 x--> 234
  208 x--> 235
  208 x--> 236
  208 x--> 237
  208 x--> 238
  208 x--> 239
  208 x--> 240
  208 x--> 241
  208 x--> 242
  208 x--> 243
  208 x--> 244
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
  245 x--> 258
  245 x--> 259
  245 x--> 260
  245 x--> 261
  245 x--> 262
  245 x--> 263
  245 x--> 264
  245 x--> 265
  245 x--> 266
  245 x--> 267
  245 x--> 268
  245 x--> 269
  245 x--> 270
  245 x--> 271
  245 x--> 272
  245 x--> 273
  245 x--> 274
  245 x--> 275
  245 x--> 276
  245 x--> 277
  245 x--> 278
  245 x--> 279
  245 x--> 280
  245 x--> 281
  282 x--> 283
  282 x--> 284
  282 x--> 285
  282 x--> 286
  282 x--> 287
  282 x--> 288
  282 x--> 289
  282 x--> 290
  282 x--> 291
  282 x--> 292
  282 x--> 293
  282 x--> 294
  282 x--> 295
  282 x--> 296
  282 x--> 297
  282 x--> 298
  282 x--> 299
  282 x--> 300
  282 x--> 301
  282 x--> 302
  282 x--> 303
  282 x--> 304
  282 x--> 305
  282 x--> 306
  282 x--> 307
  282 x--> 308
  282 x--> 309
  282 x--> 310
  282 x--> 311
  282 x--> 312
  282 x--> 313
  282 x--> 314
  282 x--> 315
  282 x--> 316
  282 x--> 317
  282 x--> 318
```
