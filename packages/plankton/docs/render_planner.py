"""Render the planner walkthrough. Use --help for export and preview options."""
from pathlib import Path
from PIL import Image, ImageDraw
from animation import (W, H, SCALE, BG, PANEL, CODE_BG, TEXT, MUTED, BORDER,
                       AMBER, CYAN, ACCENT, text, rect, line, blend, ease,
                       bezier, arrow, draw_code, render_cli)

NODES = {
    'editor': ((665, 345), 'E', AMBER, 'square'),
    'search': ((900, 345), 'S', AMBER, 'square'),
    'repeat': ((1140, 345), 'E', AMBER, 'square'),
    'storage': ((760, 492), 'D', AMBER, 'square'),
    'shortcut': ((1040, 492), 'K', CYAN, 'diamond'),
}
ORDER = ['storage', 'editor', 'shortcut', 'search']
EMIT = [(3.2, 4.5), (4.8, 6.0), (8.5, 9.8), (10.0, 11.3)]
OUTPUTS = [(640 + 170*i, 685) for i in range(4)]
CODE = [
    'const empty = () => ({ items: [] })',
    'const keys = new Facet(',
    "  'keys', (xs: readonly string[]) => xs",
    ')', '',
    'const storage = { create: empty }',
    'const shortcut = contribute(',
    "  keys, () => 'mod+k'",
    ')',
    'const editor = {',
    '  dependencies: [storage],',
    '  create: empty,',
    '}',
    'const search = {',
    '  dependencies: [storage, shortcut],',
    '  create: empty,',
    '}', '',
    'plan([editor, search, editor])',
    '  .map(({ item }) => item)',
    '// storage, editor, shortcut, search',
]
PHASES = [
    (0, 1.6, 'Start with the roots', '', 18, None),
    (1.6, 3.2, 'Read editor’s dependencies', '', 10, 'editor'),
    (3.2, 4.8, 'Add storage', '', 5, 'storage'),
    (4.8, 6.3, 'Add editor', '', 10, 'editor'),
    (6.3, 8.5, 'Skip storage', 'Already in the plan.', 14, 'search'),
    (8.5, 10.0, 'Add shortcut', '', 14, 'shortcut'),
    (10.0, 11.7, 'Add search', '', 14, 'search'),
    (11.7, 14.0, 'Skip editor', 'Same object. Already in the plan.', 18, 'repeat'),
    (14.0, 19.0, 'Done', 'Dependencies first. Each item once.', 20, None),
]


def node(draw, name, position=None, active=False, dim=False, size=56, label=True):
    default, letter, color, shape = NODES[name]
    x, y = position or default
    r = size/2
    fill = blend(PANEL, color, .13) if dim else color
    stroke = blend(PANEL, color, .55) if dim else color
    if active:
        rect(draw, (x-r-7,y-r-7,x+r+7,y+r+7), None, color, 12, 2)
    if shape == 'square':
        rect(draw, (x-r,y-r,x+r,y+r), fill, stroke, 8, 2)
    else:
        draw.polygon([(round(a*SCALE),round(b*SCALE)) for a,b in [(x,y-r-5),(x+r+5,y),(x,y+r+5),(x-r-5,y)]], fill=fill, outline=stroke, width=2*SCALE)
    text(draw, (x,y-1), letter, 'node', stroke if dim else BG, 'mm')
    if label:
        text(draw, (x,y+r+15), 'editor' if name=='repeat' else name, 'label', MUTED if dim else TEXT, 'mt')


def frame(t):
    image = Image.new('RGB', (W*SCALE,H*SCALE), BG)
    d = ImageDraw.Draw(image)

    text(d, (32,58), 'Dependency planning', 'title')

    rect(d, (32,128,534,808), CODE_BG, BORDER)
    rect(d, (552,128,1248,808), PANEL, BORDER)
    text(d, (54,174), 'Code', 'eyebrow', MUTED)
    rect(d, (1051,167,1228,198), '#242a38', BORDER, 8)
    text(d, (1139,182), 'create() calls: 0', 'eyebrow', ACCENT, 'mm')
    phase = next(p for p in PHASES if p[0] <= t < p[1])
    start,end,title,caption,highlight,selected=phase
    text(d, (574,216), title, 'stage')
    text(d, (574,251), caption, 'body', MUTED)
    draw_code(d, CODE, highlight, t>=14)
    text(d, (574,291), 'Roots', 'eyebrow', MUTED)
    text(d, (574,443), 'Dependencies', 'eyebrow', MUTED)
    # Dependency arrows point from owner to prerequisite, not execution order.
    links = [
        ('editor','storage',[(665,375),(665,430),(760,426),(760,459)]),
        ('search','storage',[(900,375),(900,425),(760,425),(760,459)]),
        ('search','shortcut',[(900,375),(900,425),(1040,425),(1040,454)]),
    ]
    for owner,dep,path in links:
        active = (1.6<=t<4.5 and owner=='editor') or (6.3<=t<8.5 and owner=='search' and dep=='storage') or (8.5<=t<9.8 and dep=='shortcut')
        arrow(d,path,blend(BORDER,CYAN,.85) if active else BORDER,3 if active else 2)
    for name in NODES:
        node(d,name,active=selected==name,dim=t>=14 or name=='repeat')
    text(d, (1140,407), 'same identity', 'small', MUTED, 'mt')
    planned = sum(t>=b for a,b in EMIT)
    text(d, (574,607), 'Plan', 'eyebrow', MUTED)
    text(d, (1226,607), f'{planned} / 4', 'eyebrow', ACCENT, 'rt')
    for i,(name,(a,b),position) in enumerate(zip(ORDER,EMIT,OUTPUTS)):
        x,y=position
        if t>=b:
            node(d,name,position,size=52)
        else:
            rect(d,(x-28,y-28,x+28,y+28),None,BORDER,8)
            text(d,(x,y),str(i+1),'label','#939cb0','mm')
        if i<3:
            arrow(d,[(x+41,y),(x+60,y),(x+82,y),(x+119,y)],BORDER,2)
        if a<=t<b:
            sx,sy=NODES[name][0]
            p=ease((t-a)/(b-a))
            moving=bezier([(sx,sy),(sx,sy+100),(x,y-95),(x,y)],p)
            node(d,name,moving,size=52)
    if 6.3<=t<8.5:
        rect(d,(704,565,815,595),'#173c4a',CYAN,8)
        text(d,(759,580),'skip','small',CYAN,'mm')
        rect(d,(605,650,675,720),None,CYAN,10,2)
    if 11.7<=t<14:
        rect(d,(1082,436,1197,466),'#173c4a',CYAN,8)
        text(d,(1139,451),'skip','small',CYAN,'mm')
        rect(d,(775,650,845,720),None,CYAN,10,2)
    # Legends explain type, while labels/letters explain identity.
    rect(d,(57,748,75,766),AMBER,AMBER,3)
    text(d,(85,747),'Subtree','small',TEXT)
    d.polygon([(183*SCALE,747*SCALE),(193*SCALE,757*SCALE),(183*SCALE,767*SCALE),(173*SCALE,757*SCALE)],fill=CYAN,outline=CYAN,width=SCALE)
    text(d,(205,747),'Binding','small',TEXT)


    line(d,[(574,797),(1226,797)],BORDER,2)
    line(d,[(574,797),(574+652*min(t/14,1),797)],ACCENT,2)
    return image.resize((W,H),Image.Resampling.LANCZOS)



if __name__ == "__main__":
    render_cli(frame, Path(__file__).resolve().parent, "planner", 19, 15)
