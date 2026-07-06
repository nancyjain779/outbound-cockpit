from __future__ import annotations

from typing import Any, Literal, TypedDict


class OutreachAgentState(TypedDict, total=False):
    # Input
    intent: Literal["analyse", "classify", "chat"]
    prospect: dict[str, Any]
    opener_keys: list[str]
    extra_context: str
    deep_research: bool
    pull_profile: bool
    chat_message: str
    thread_id: str
    opener_map: dict[str, list[str]]

    # Classify input
    classify_text: str
    classify_url: str
    hint_track: str

    # Gathered evidence
    company_facts: dict[str, Any] | None
    hiring_titles: list[str]
    all_roles: list[str]
    site_text: str
    linkedin_data: dict[str, Any] | None
    web_research: dict[str, Any] | None
    credits_consumed: int

    # Agent output
    brief: dict[str, Any] | None
    draft_message: str
    validation: dict[str, Any] | None
    classify_result: dict[str, Any] | None
    chat_reply: str

    # Tool planning / execution
    tools_queue: list[dict[str, Any]]
    tools_completed: int
    plan_reasoning: str
    planned_tools: list[dict[str, Any]]
    current_tool: str | None
    last_tool_result: dict[str, Any] | None

    # Control
    tool_trace: list[dict[str, Any]]
    retry_count: int
    max_retries: int
    mode: str
    error: str | None
    run_id: str
