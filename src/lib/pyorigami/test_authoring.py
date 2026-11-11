"""Regression tests for the shared, non-executing authoring service."""
import unittest

from authoring import author_source, inspect_authoring

SOURCE = '''from pyorigami import Diagram, DiagramHeader, Step, Square

# Keep the user's introduction.
diagram = Diagram(
    header=DiagramHeader(body=[]),
    body=[
        Step(body=[Square("a", "b", "c", "d")]), # keep this step
    ],
)
'''


def evaluate(source):
    namespace = {}
    exec(source, namespace)
    return namespace


class AuthoringTests(unittest.TestCase):
    def test_missing_property_adds_its_import_and_preserves_comments(self):
        changed = author_source(SOURCE, {"kind": "property", "property": "title", "value": 'A "quoted" title'})
        self.assertEqual(evaluate(changed)["diagram"].header.body[0].name, 'A "quoted" title')
        self.assertIn("# Keep the user's introduction.", changed)
        self.assertIn('Step(body=[Square("a", "b", "c", "d")]), # keep this step', changed)

    def test_module_and_constructor_aliases_are_reused(self):
        for source, reference in (
            ('import pyorigami as ori\ndiagram = ori.Diagram(ori.DiagramHeader(), [ori.Step()])\n', 'ori.Caption'),
            ('from pyorigami import Diagram, DiagramHeader, Step, Caption as C\ndiagram = Diagram(DiagramHeader(), [Step()])\n', 'C'),
        ):
            with self.subTest(reference=reference):
                changed = author_source(source, {"kind": "caption", "step": 0, "value": "Fold here"})
                self.assertIn(reference + "('Fold here')", changed)
                self.assertEqual(evaluate(changed)["diagram"].body[0].body[0].text, "Fold here")
                self.assertEqual(changed.count("import "), source.count("import "))

    def test_imports_do_not_shadow_an_existing_binding(self):
        source = SOURCE.replace('# Keep', 'Caption = "keep this binding"\n\n# Keep')
        changed = author_source(source, {"kind": "caption", "step": 0, "value": "A caption"})
        namespace = evaluate(changed)
        self.assertEqual(namespace["Caption"], "keep this binding")
        self.assertEqual(namespace["diagram"].body[0].body[-1].text, "A caption")
        self.assertIn('Caption as _OrigamiCaption1', changed)

    def test_caption_updates_do_not_duplicate_imports_or_commands(self):
        changed = author_source(SOURCE, {"kind": "caption", "step": 0, "value": "First"})
        for value in ("Second", "Third"):
            changed = author_source(changed, {"kind": "caption", "step": 0, "value": value})
        captions = [command for command in evaluate(changed)["diagram"].body[0].body if type(command).__name__ == "Caption"]
        self.assertEqual([caption.text for caption in captions], ["Third"])
        self.assertEqual(changed.count("Caption("), 1)

    def test_each_caption_can_be_edited_independently(self):
        changed = author_source(SOURCE, {"kind": "caption", "step": 0, "value": "First"})
        changed = author_source(changed, {"kind": "caption", "step": 0, "caption": 1, "value": "Second"})
        changed = author_source(changed, {"kind": "caption", "step": 0, "caption": 1, "value": "Edited second"})
        self.assertEqual(inspect_authoring(changed)["steps"][0]["captions"], [
            {"value": "First", "editable": True}, {"value": "Edited second", "editable": True}])

    def test_appending_a_step_keeps_the_original_steps_and_trailing_comment(self):
        changed = author_source(SOURCE, {"kind": "addStep"})
        diagram = evaluate(changed)["diagram"]
        self.assertEqual(len(diagram.body), 2)
        self.assertEqual(type(diagram.body[0].body[0]).__name__, "Square")
        self.assertEqual(diagram.body[1].body, [])
        self.assertIn('# keep this step', changed)

    def test_first_step_gets_a_sheet_of_paper_and_all_required_imports(self):
        source = 'from pyorigami import Diagram, DiagramHeader\ndiagram = Diagram(DiagramHeader(), [])\n'
        changed = author_source(source, {"kind": "addStep"})
        self.assertEqual(type(evaluate(changed)["diagram"].body[0].body[0]).__name__, "Square")

    def test_missing_default_body_is_created_without_losing_argument_comments(self):
        for source in (
            'from pyorigami import Diagram, DiagramHeader\ndiagram = Diagram(DiagramHeader())\n',
            'from pyorigami import Diagram, DiagramHeader\ndiagram = Diagram(\n    header=DiagramHeader(), # keep header\n)\n',
        ):
            changed = author_source(source, {"kind": "addStep"})
            self.assertEqual(len(evaluate(changed)["diagram"].body), 1)
            if '# keep header' in source:
                self.assertIn('# keep header', changed)

    def test_computed_values_are_read_only_without_blocking_other_fields(self):
        source = SOURCE.replace('DiagramHeader(body=[])', 'DiagramHeader(body=[Title("a" + "b")])').replace('import Diagram,', 'import Title, Diagram,')
        model = inspect_authoring(source)
        self.assertFalse(model["properties"]["title"]["editable"])
        self.assertTrue(model["properties"]["designer"]["editable"])
        with self.assertRaisesRegex(ValueError, 'computed'):
            author_source(source, {"kind": "property", "property": "title", "value": "Replacement"})

    def test_dynamic_structure_and_post_construction_mutation_are_not_rewritten(self):
        for source in (
            SOURCE + 'diagram.body.reverse()\n',
            SOURCE.replace('body=[\n        Step', 'body=[\n        *[Step').replace(']), # keep this step', '])], # keep this step'),
            'from pyorigami import *\ndiagram = make_diagram()\n',
        ):
            with self.subTest(source=source):
                self.assertFalse(inspect_authoring(source)["canAddStep"])
                with self.assertRaises(ValueError):
                    author_source(source, {"kind": "addStep"})

    def test_inspection_and_editing_do_not_execute_the_program(self):
        source = 'untouched = explode_if_executed()\n' + SOURCE
        changed = author_source(source, {"kind": "property", "property": "designer", "value": "Safe"})
        self.assertIn('untouched = explode_if_executed()', changed)
        self.assertEqual(inspect_authoring(changed)["properties"]["designer"]["value"], "Safe")

    def test_named_colors_become_rgb_values_supported_by_the_python_renderer(self):
        changed = author_source(SOURCE, {"kind": "property", "property": "colorFront", "value": "red"})
        self.assertEqual(evaluate(changed)["diagram"].header.body[0].color, (100, 0, 0))
        with self.assertRaises(ValueError):
            author_source(SOURCE, {"kind": "property", "property": "colorFront", "value": "999, 0, 0"})


if __name__ == '__main__':
    unittest.main()
