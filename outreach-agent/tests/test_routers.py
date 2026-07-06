from agent.routers import (
    route_after_execute,
    route_after_synthesize,
    route_after_validate,
    route_by_intent,
    route_chat,
)


def test_route_analyse():
    assert route_by_intent({"intent": "analyse"}) == "plan"


def test_route_classify():
    assert route_by_intent({"intent": "classify"}) == "classify"


def test_route_chat_synthesize():
    assert route_after_synthesize({"intent": "chat"}) == "chat_reply"


def test_route_analyse_validate():
    assert route_after_synthesize({"intent": "analyse"}) == "validate"


def test_validate_retry():
    assert route_after_validate({"validation": {"pass": False}, "retry_count": 0, "max_retries": 2}) == "retry"


def test_validate_persist():
    assert route_after_validate({"validation": {"pass": True}, "retry_count": 0}) == "persist"


def test_route_chat_research():
    assert route_chat({"chat_message": "research their funding round"}) == "plan"


def test_route_chat_revise():
    assert route_chat({"chat_message": "make it shorter"}) == "synthesize"


def test_execute_loop():
    assert route_after_execute({"tools_queue": [{"name": "a"}]}) == "execute_tool"
    assert route_after_execute({"tools_queue": []}) == "synthesize"
