"""Pytest configuration and test fixtures for SemantiX."""

import os
import shutil
import tempfile
import pytest
import git


@pytest.fixture
def temp_git_repo():
    """Creates a temporary 3-commit Git repository with Python and JS files for testing."""
    temp_dir = tempfile.mkdtemp(prefix="semantix_test_repo_")
    repo = git.Repo.init(temp_dir)
    
    # Configure git user for commit creation
    with repo.config_writer() as config:
        config.set_value("user", "name", "Test Developer")
        config.set_value("user", "email", "test@example.com")

    # Commit 1: Initial creation of main.py and utils.js
    main_py_path = os.path.join(temp_dir, "main.py")
    utils_js_path = os.path.join(temp_dir, "utils.js")

    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write("def Greet(name):\n    print('Hello ' + name)\n")

    with open(utils_js_path, "w", encoding="utf-8") as f:
        f.write("function add(a, b) {\n    return a + b;\n}\n")

    repo.index.add(["main.py", "utils.js"])
    repo.index.commit("Initial commit: Add main.py and utils.js")

    # Commit 2: Modify main.py (logic change + add function) and utils.js
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write("def Greet(name):\n    # Updated greeting\n    print(f'Hello, {name}!')\n\ndef calculate_total(prices):\n    return sum(prices)\n")

    with open(utils_js_path, "w", encoding="utf-8") as f:
        f.write("function add(a, b) {\n    return a + b;\n}\nfunction multiply(a, b) {\n    return a * b;\n}\n")

    repo.index.add(["main.py", "utils.js"])
    repo.index.commit("Commit 2: Update greeting and add multiply helper")

    # Commit 3: Refactor calculate_total to include tax in main.py
    with open(main_py_path, "w", encoding="utf-8") as f:
        f.write("def Greet(name):\n    print(f'Hello, {name}!')\n\ndef calculate_total(prices, tax_rate=0.05):\n    subtotal = sum(prices)\n    return subtotal * (1 + tax_rate)\n")

    repo.index.add(["main.py"])
    repo.index.commit("Commit 3: Refactor calculate_total with tax support")

    yield temp_dir

    # Cleanup temp directory
    shutil.rmtree(temp_dir, ignore_errors=True)
