"""Static dependency graph construction using stdlib ast for Python and tree-sitter for JS."""

import ast
import logging
from typing import Dict, List, Set, Optional
import networkx as nx
from semantix.semantic_diff.parser import parse_code

logger = logging.getLogger("semantix.dependency_graph.graph_builder")


class DependencyGraphBuilder:
    """Builds a NetworkX directed graph of files, functions, classes, imports, and calls."""

    def __init__(self):
        self.graph = nx.DiGraph()

    def build_graph_for_files(self, file_contents: Dict[str, str]) -> nx.DiGraph:
        """Construct graph given a mapping of file_path -> code_content."""
        self.graph.clear()
        
        # Track known python modules
        module_to_file = {}
        for file_path in file_contents.keys():
            self.graph.add_node(file_path, node_type="file")
            if file_path.endswith(".py"):
                mod_name = file_path[:-3].replace("/", ".").replace("\\", ".")
                module_to_file[mod_name] = file_path

        # Parse definitions and edges
        for file_path, code in file_contents.items():
            if not code or not code.strip():
                continue
            
            ext = file_path.lower().split(".")[-1] if "." in file_path else ""
            if ext in ("py", "pyw"):
                self._parse_python_file(file_path, code, module_to_file)
            elif ext in ("js", "jsx", "mjs", "cjs"):
                self._parse_js_file(file_path, code)

        return self.graph

    def _parse_python_file(self, file_path: str, code: str, module_to_file: Dict[str, str]):
        try:
            tree = ast.parse(code, filename=file_path)
        except Exception as e:
            logger.warning(f"Python AST parse error in {file_path}: {e}")
            return

        for node in ast.walk(tree):
            # Imports
            if isinstance(node, ast.Import):
                for alias in node.names:
                    target_mod = alias.name
                    target_file = module_to_file.get(target_mod, target_mod)
                    self.graph.add_node(target_file, node_type="module")
                    self.graph.add_edge(file_path, target_file, relation="imports")

            elif isinstance(node, ast.ImportFrom):
                module_name = node.module or ""
                target_file = module_to_file.get(module_name, module_name)
                for alias in node.names:
                    target_symbol = f"{target_file}:{alias.name}" if ":" not in target_file else target_file
                    self.graph.add_node(target_symbol, node_type="imported_symbol")
                    self.graph.add_edge(file_path, target_symbol, relation="imports")
                    self.graph.add_edge(file_path, target_file, relation="imports")

            # Function definitions
            elif isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                func_node_id = f"{file_path}:{node.name}"
                self.graph.add_node(func_node_id, node_type="function", name=node.name, file=file_path)
                self.graph.add_edge(file_path, func_node_id, relation="defines")

                # Function calls inside this function
                for child in ast.walk(node):
                    if isinstance(child, ast.Call):
                        callee_name = self._get_python_call_name(child.func)
                        if callee_name:
                            callee_id = f"{file_path}:{callee_name}" if "." not in callee_name else callee_name
                            self.graph.add_node(callee_id, node_type="function_or_call")
                            self.graph.add_edge(func_node_id, callee_id, relation="calls")

            # Class definitions
            elif isinstance(node, ast.ClassDef):
                class_node_id = f"{file_path}:{node.name}"
                self.graph.add_node(class_node_id, node_type="class", name=node.name, file=file_path)
                self.graph.add_edge(file_path, class_node_id, relation="defines")

    def _get_python_call_name(self, call_func_node) -> Optional[str]:
        if isinstance(call_func_node, ast.Name):
            return call_func_node.id
        elif isinstance(call_func_node, ast.Attribute):
            return call_func_node.attr
        return None

    def _parse_js_file(self, file_path: str, code: str):
        ts_tree = parse_code(code, file_path)
        if not ts_tree:
            return

        code_bytes = code.encode("utf-8")

        def _traverse(node):
            if node.type in ("function_declaration", "generator_function_declaration"):
                name_node = node.child_by_field_name("name")
                if name_node:
                    func_name = code_bytes[name_node.start_byte:name_node.end_byte].decode("utf-8", errors="ignore")
                    func_node_id = f"{file_path}:{func_name}"
                    self.graph.add_node(func_node_id, node_type="function", name=func_name, file=file_path)
                    self.graph.add_edge(file_path, func_node_id, relation="defines")

            elif node.type == "call_expression":
                fn_node = node.child_by_field_name("function")
                if fn_node:
                    callee_name = code_bytes[fn_node.start_byte:fn_node.end_byte].decode("utf-8", errors="ignore")
                    if callee_name in ("require", "import"):
                        pass
                    else:
                        callee_id = f"{file_path}:{callee_name}"
                        self.graph.add_node(callee_id, node_type="function_or_call")
                        self.graph.add_edge(file_path, callee_id, relation="calls")

            for child in node.children:
                _traverse(child)

        _traverse(ts_tree.root_node)
