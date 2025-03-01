test:
    uv pip install .[test]
    uv run pytest tests/tests.py
setup-uv:
    uv python install
    uv venv .venv
    echo "VIRTUAL_ENV=.venv" >> $GITHUB_ENV
    echo "$PWD/.venv/bin" >> $GITHUB_PATH
