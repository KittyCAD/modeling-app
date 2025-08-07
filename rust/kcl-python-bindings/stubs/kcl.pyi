# flake8: noqa: PYI021
def execute(path):
    """Execute the kcl code from a file path."""

def execute_and_export(path, export_format):
    """Execute a kcl file and export it to a specific file format."""

def execute_and_snapshot(path, image_format):
    """Execute a kcl file and snapshot it in a specific format."""

def execute_and_snapshot_views(path, image_format, snapshot_options):
    ...

def execute_code(code):
    """Execute the kcl code."""

def execute_code_and_export(code, export_format):
    """Execute the kcl code and export it to a specific file format."""

def execute_code_and_snapshot(code, image_format):
    """Execute the kcl code and snapshot it in a specific format."""

def execute_code_and_snapshot_views(code, image_format, snapshot_options):
    """
    Execute the kcl code and snapshot it in a specific format.
    Returns one image for each camera angle you provide.
    If you don't provide any camera angles, a default head-on camera angle will be used.
    """

def format(code):
    """Format the kcl code. This will return the formatted code."""

def format_dir(dir):
    """Format a whole directory of kcl code."""

def import_and_snapshot(filepaths, format, image_format):
    ...

def import_and_snapshot_views(filepaths, format, image_format, snapshot_options):
    ...

def lint(code):
    """Lint the kcl code."""

def mock_execute(path):
    """Mock execute the kcl code from a file path."""

def mock_execute_code(code):
    """Mock execute the kcl code."""

def parse(path):
    """Parse the kcl code from a file path."""

def parse_code(code):
    """Parse the kcl code."""
