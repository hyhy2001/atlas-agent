## Codebase Memory (codebase-memory-mcp)

When this MCP server is available, **prefer graph tools over grep/Explore for structural code questions**.
Graph queries return precise results in a single tool call (~500 tokens) vs file-by-file exploration (~80K tokens).

- **Before exploration/planning**: Run `index_repository` to ensure the graph is current
- **"Who calls X?"**: `trace_call_path(function_name="X", direction="inbound")`
- **"What does X call?"**: `trace_call_path(function_name="X", direction="outbound")`
- **Find functions by pattern**: `search_graph(label="Function", name_pattern=".*Pattern.*")`
- **Dead code**: `search_graph(label="Function", relationship="CALLS", direction="inbound", max_degree=0, exclude_entry_points=true)`
- **Cross-service calls**: `search_graph(relationship="HTTP_CALLS")` or `query_graph` with Cypher
- **REST routes**: `search_graph(label="Route")`
- **Understand structure first**: `get_graph_schema` before writing complex queries
- **Read source**: `get_code_snippet(qualified_name="...")` after finding functions via search
- **Complex patterns**: `query_graph` with Cypher for multi-hop graph traversals

Use grep/Glob for text search (string literals, error messages, config values) — the graph doesn't index text content.
