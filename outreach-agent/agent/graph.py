from __future__ import annotations

from langgraph.graph import END, START, StateGraph

from agent.nodes import (
    chat_reply_node,
    classify_node,
    execute_tool_node,
    increment_retry,
    load_memory_node,
    persist_node,
    plan_gather_node,
    route_input,
    synthesize_node,
    validate_node,
)
from agent.routers import (
    route_after_execute,
    route_after_synthesize,
    route_after_validate,
    route_by_intent,
    route_chat,
)
from agent.state import OutreachAgentState


def build_graph():
    g = StateGraph(OutreachAgentState)

    g.add_node("route_input", route_input)
    g.add_node("plan_gather", plan_gather_node)
    g.add_node("execute_tool", execute_tool_node)
    g.add_node("synthesize", synthesize_node)
    g.add_node("validate", validate_node)
    g.add_node("increment_retry", increment_retry)
    g.add_node("persist", persist_node)
    g.add_node("classify", classify_node)
    g.add_node("load_memory", load_memory_node)
    g.add_node("chat_reply", chat_reply_node)

    g.add_edge(START, "route_input")
    g.add_conditional_edges("route_input", route_by_intent, {
        "plan": "plan_gather",
        "classify": "classify",
        "chat": "load_memory",
    })
    g.add_edge("plan_gather", "execute_tool")
    g.add_conditional_edges("execute_tool", route_after_execute, {
        "execute_tool": "execute_tool",
        "synthesize": "synthesize",
    })
    g.add_conditional_edges("synthesize", route_after_synthesize, {
        "validate": "validate",
        "chat_reply": "chat_reply",
    })
    g.add_conditional_edges("validate", route_after_validate, {
        "persist": "persist",
        "retry": "increment_retry",
    })
    g.add_edge("increment_retry", "synthesize")
    g.add_edge("persist", END)
    g.add_edge("classify", END)

    g.add_conditional_edges("load_memory", route_chat, {
        "plan": "plan_gather",
        "synthesize": "synthesize",
    })
    g.add_edge("chat_reply", END)

    return g.compile()


_chain = None


def get_chain():
    global _chain
    if _chain is None:
        _chain = build_graph()
    return _chain
