"""Source-preserving pyOrigami operations, shared by rendering and editor clients.

Only direct Diagram/Header/Step declarations with literal body lists are editable.
Inspection and transformation never execute the user's Python program.
"""

import ast
import json

import libcst as cst
from libcst.codemod import CodemodContext
from libcst.codemod.visitors import AddImportsVisitor
from libcst.metadata import MetadataWrapper, QualifiedNameProvider, ScopeProvider


PROPERTIES = {
    "title": ("Title", "name"),
    "designer": ("Designer", "name"),
    "diagrammer": ("Diagrammer", "name"),
    "colorFront": ("ColorFront", "color"),
    "colorBack": ("ColorBack", "color"),
}


def argument(call, name, position):
    if any(arg.star for arg in call.args):
        raise ValueError("Expanded constructor arguments must be edited in Code mode.")
    for arg in call.args:
        if arg.keyword and arg.keyword.value == name:
            return arg
    positional = [arg for arg in call.args if arg.keyword is None]
    return positional[position] if position < len(positional) else None


def set_argument(call, name, position, value):
    existing = argument(call, name, position)
    if existing:
        return call.with_changes(args=[arg.with_changes(value=value) if arg is existing else arg for arg in call.args])
    new_arg = cst.Arg(keyword=cst.Name(name), value=value,
                      equal=cst.AssignEqual(cst.SimpleWhitespace(""), cst.SimpleWhitespace("")))
    if not call.args:
        return call.with_changes(args=[new_arg])
    args = list(call.args)
    last = args[-1]
    opening = call.whitespace_before_args
    closing = last.comma.whitespace_after if isinstance(last.comma, cst.Comma) else last.whitespace_after_arg
    if isinstance(opening, cst.ParenthesizedWhitespace) and isinstance(closing, cst.ParenthesizedWhitespace):
        args[-1] = last.with_changes(comma=cst.Comma(whitespace_after=closing.with_changes(last_line=opening.last_line)), whitespace_after_arg=cst.SimpleWhitespace(""))
        clean_closing = closing.with_changes(first_line=cst.TrailingWhitespace(newline=closing.first_line.newline), empty_lines=[])
        return call.with_changes(args=[*args, new_arg.with_changes(comma=cst.Comma(whitespace_after=clean_closing))])
    args[-1] = last.with_changes(comma=cst.Comma(whitespace_after=cst.SimpleWhitespace(" ")), whitespace_after_arg=cst.SimpleWhitespace(""))
    return call.with_changes(args=[*args, new_arg.with_changes(whitespace_after_arg=last.whitespace_after_arg)])


def append_element(body, expression):
    elements = list(body.elements)
    if not elements:
        return body.with_changes(elements=[cst.Element(expression)])
    first_space = body.lbracket.whitespace_after
    last_space = body.rbracket.whitespace_before
    if isinstance(first_space, cst.ParenthesizedWhitespace) and isinstance(last_space, cst.ParenthesizedWhitespace):
        # Move the old closing-bracket trivia with its element, retaining comments.
        elements[-1] = elements[-1].with_changes(comma=cst.Comma(
            whitespace_after=last_space.with_changes(last_line=first_space.last_line)))
        closing = last_space.with_changes(first_line=cst.TrailingWhitespace(newline=last_space.first_line.newline), empty_lines=[])
        return body.with_changes(elements=[*elements, cst.Element(expression, comma=cst.Comma())],
                                 rbracket=body.rbracket.with_changes(whitespace_before=closing))
    trailing_comma = isinstance(elements[-1].comma, cst.Comma)
    elements[-1] = elements[-1].with_changes(comma=cst.Comma(whitespace_after=cst.SimpleWhitespace(" ")))
    return body.with_changes(elements=[*elements, cst.Element(expression, comma=cst.Comma() if trailing_comma else cst.MaybeSentinel.DEFAULT)])


class ReplaceNode(cst.CSTTransformer):
    def __init__(self, target, replacement):
        self.target, self.replacement = target, replacement

    def on_leave(self, original_node, updated_node):
        return self.replacement if original_node is self.target else updated_node


class AuthoringDocument:
    def __init__(self, source):
        self.wrapper = MetadataWrapper(cst.parse_module(source))
        self.module = self.wrapper.module
        self.qualified = self.wrapper.resolve(QualifiedNameProvider)
        self.scopes = self.wrapper.resolve(ScopeProvider)
        assignments = []
        for statement in self.module.body:
            if not isinstance(statement, cst.SimpleStatementLine):
                raise ValueError("Visual authoring supports direct diagram declarations; edit this program in Code mode.")
            for item in statement.body:
                if isinstance(item, cst.Assign) and any(isinstance(target.target, cst.Name) and target.target.value == "diagram" for target in item.targets):
                    assignments.append(item)
        if len(assignments) != 1 or len(assignments[0].targets) != 1:
            raise ValueError("Define diagram once with a direct Diagram(...) declaration to author it visually.")
        self.root = assignments[0].value
        if self.constructor(self.root) != "Diagram":
            raise ValueError("Computed diagrams must be edited in Code mode.")
        # A later mutation or use through an alias makes static source ownership ambiguous.
        class References(cst.CSTVisitor):
            count = 0
            def visit_Name(self, node):
                if node.value == "diagram":
                    self.count += 1
        refs = References()
        self.module.visit(refs)
        if refs.count != 1:
            raise ValueError("Programs that use or mutate diagram after construction must be edited in Code mode.")
        header_arg = argument(self.root, "header", 0)
        self.header = header_arg.value if header_arg else None
        if self.constructor(self.header) != "DiagramHeader":
            raise ValueError("Use a direct DiagramHeader(...) declaration for visual authoring.")
        self.header_body = self.body(self.header)
        self.diagram_body = self.body(self.root, 1)
        self.steps = []
        for element in self.diagram_body.elements:
            if not isinstance(element, cst.Element) or self.constructor(element.value) is None:
                raise ValueError("Computed step lists must be edited in Code mode.")
            if self.constructor(element.value) == "Step":
                self.body(element.value)
                self.steps.append(element.value)

    def constructor(self, expression):
        if not isinstance(expression, cst.Call):
            return None
        names = self.qualified.get(expression.func, set())
        if callable(names):
            names = names()
        if len(names) != 1:
            return None
        name = next(iter(names)).name
        for prefix in ("pyorigami.", "pyorigami.commands."):
            if name.startswith(prefix) and "." not in name[len(prefix):]:
                return name[len(prefix):]
        return None

    def body(self, call, position=0):
        arg = argument(call, "body", position)
        if arg is None:
            return cst.List([])
        if not isinstance(arg.value, cst.List) or any(not isinstance(element, cst.Element) or self.constructor(element.value) is None for element in arg.value.elements):
            raise ValueError("Visual authoring requires literal body lists.")
        return arg.value

    def calls(self, body, constructor):
        return [element.value for element in body.elements if self.constructor(element.value) == constructor]

    def field(self, call, parameter="text"):
        if call is None:
            return {"value": "", "editable": True}
        arg = argument(call, parameter, 0)
        if arg:
            try:
                value = ast.literal_eval(self.module.code_for_node(arg.value))
                if isinstance(value, str):
                    return {"value": value, "editable": True}
                if parameter == "color" and isinstance(value, tuple) and len(value) == 3:
                    return {"value": ", ".join(str(v) for v in value), "editable": True}
            except (ValueError, SyntaxError):
                pass
        return {"value": "", "editable": False}

    def inspect(self):
        properties = {}
        for key, (constructor, parameter) in PROPERTIES.items():
            calls = self.calls(self.header_body, constructor)
            properties[key] = self.field(calls[-1] if calls else None, parameter)
        return {"properties": properties, "steps": [
            {"captions": [self.field(call) for call in self.calls(self.body(step), "Caption")]}
            for step in self.steps
        ], "canAddStep": True}

    def reference(self, constructor, context):
        scope = self.scopes[self.root]
        # Reuse a binding only when it has a single, unambiguous import assignment.
        for name in dict.fromkeys(assignment.name for assignment in scope.assignments):
            assignments = list(scope[name])
            if len(assignments) != 1 or not isinstance(assignments[0].node, (cst.Import, cst.ImportFrom)):
                continue
            names = {qualified.name for qualified in assignments[0].get_qualified_names_for(name)}
            if names == {"pyorigami." + constructor} or names == {"pyorigami.commands." + constructor}:
                return cst.Name(name)
            if names == {"pyorigami"}:
                return cst.Attribute(cst.Name(name), cst.Name(constructor))
        name = constructor
        suffix = 1
        while name in scope:
            name = f"_Origami{constructor}{suffix}"
            suffix += 1
        AddImportsVisitor.add_needed_import(context, "pyorigami", constructor, asname=None if name == constructor else name)
        return cst.Name(name)

    def apply(self, operation):
        kind = operation.get("kind")
        context = CodemodContext()
        if kind == "addStep":
            initial = []
            if not self.steps:
                initial = [cst.Element(cst.Call(self.reference("Square", context), [cst.Arg(cst.SimpleString(repr(name))) for name in ("a", "b", "c", "d")]))]
            call = cst.Call(self.reference("Step", context), [cst.Arg(keyword=cst.Name("body"), value=cst.List(initial), equal=cst.AssignEqual(cst.SimpleWhitespace(""), cst.SimpleWhitespace("")))])
            target, replacement = self.root, set_argument(self.root, "body", 1, append_element(self.diagram_body, call))
        elif kind in ("property", "caption"):
            value = operation.get("value")
            if not isinstance(value, str):
                raise ValueError("An authoring value must be text.")
            if kind == "property":
                prop = operation.get("property")
                if prop not in PROPERTIES:
                    raise ValueError("Unknown diagram property.")
                constructor, parameter = PROPERTIES[prop]
                owner, body = self.header, self.header_body
                matches = self.calls(body, constructor)
                existing = matches[-1] if matches else None
            else:
                step, caption = operation.get("step"), operation.get("caption", 0)
                if type(step) is not int or not 0 <= step < len(self.steps):
                    raise ValueError("The selected step no longer exists.")
                owner, constructor, parameter = self.steps[step], "Caption", "text"
                body = self.body(owner)
                matches = self.calls(body, constructor)
                if type(caption) is not int or not 0 <= caption <= len(matches):
                    raise ValueError("The selected caption no longer exists.")
                existing = matches[caption] if caption < len(matches) else None
            if existing and not self.field(existing, parameter)["editable"]:
                raise ValueError("This value is computed. Edit its expression in Code mode.")
            expression = cst.SimpleString(repr(value))
            if parameter == "color":
                if "," in value:
                    channels = [int(part.strip()) for part in value.split(",")]
                    if len(channels) != 3 or any(not 0 <= channel <= 100 for channel in channels):
                        raise ValueError("Use a named color or three RGB percentages from 0 to 100.")
                    expression = cst.parse_expression(repr(tuple(channels)))
                else:
                    colors = {"white": (100, 100, 100), "black": (0, 0, 0), "red": (100, 0, 0), "green": (0, 100, 0), "blue": (0, 0, 100), "yellow": (100, 100, 0), "cyan": (0, 100, 100), "magenta": (100, 0, 100), "gray": (50, 50, 50)}
                    if value not in colors:
                        raise ValueError("Use a named color or three RGB percentages from 0 to 100.")
                    expression = cst.parse_expression(repr(colors[value]))
            if existing:
                target, replacement = existing, set_argument(existing, parameter, 0, expression)
            else:
                call = cst.Call(self.reference(constructor, context), [cst.Arg(expression)])
                target, replacement = owner, set_argument(owner, "body", 0, append_element(body, call))
        else:
            raise ValueError("Unknown authoring operation.")
        changed = self.module.visit(ReplaceNode(target, replacement))
        return AddImportsVisitor(context).transform_module(changed).code


def inspect_authoring(source):
    try:
        return AuthoringDocument(source).inspect()
    except (ValueError, cst.ParserSyntaxError) as error:
        return {"error": str(error), "canAddStep": False, "properties": {}, "steps": []}


def author_source(source, operation):
    return AuthoringDocument(source).apply(operation)
