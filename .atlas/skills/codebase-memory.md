# codebase-memory-mcp Skill

## When to use

- Structural code questions: "who calls X?", "what does X depend on?", "show me the call chain"
- Dead code analysis: functions with zero callers
- Cross-service tracing: HTTP call paths between microservices
- Architecture overview: understanding module boundaries and dependencies
- Pre-planning: index before designing changes to understand blast radius

## When NOT to use

- Text search (use grep/Glob instead)
- Single file reads (use Read tool instead)
- Syntax/formatting questions (not a graph concern)

## Workflow

1. **Ensure freshness**: `list_projects` to check `indexed_at`. If stale, `index_repository`.
2. **Understand schema**: `get_graph_schema` to see what's indexed (node counts, edge types).
3. **Search**: `search_graph` for filtered queries, `trace_call_path` for call chains.
4. **Deep dive**: `get_code_snippet` to read source of interesting functions.
5. **Complex queries**: `query_graph` with Cypher for multi-hop patterns.

## Tips

- `trace_call_path` with `direction="both"` shows full context (callers + callees)
- `search_graph` with `file_pattern` scopes results to a service/directory
- Route nodes (`label="Route"`) let you query REST endpoints as graph entities
- Edge properties on HTTP_CALLS include `confidence` and `url_path`
- Reindex after significant code changes (new files, moved functions)
