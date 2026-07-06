"""FastAPI service for LangGraph outreach agent."""
from __future__ import annotations

import logging
import os
import uuid

from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel, Field

load_dotenv()

logging.basicConfig(level=logging.INFO, format="%(message)s")
logger = logging.getLogger("outreach-agent")

app = FastAPI(title="Outreach Agent", version="1.0.0")


class AnalyseRequest(BaseModel):
    prospect: dict = Field(default_factory=dict)
    openerKeys: list[str] = Field(default_factory=list)
    extraContext: str = ""
    deep: bool = False
    pullProfile: bool = False


class ClassifyRequest(BaseModel):
    text: str
    url: str = ""
    hintTrack: str = ""
    openerMap: dict[str, list[str]] = Field(default_factory=dict)


class ChatRequest(BaseModel):
    prospect_id: str
    message: str
    prospect: dict = Field(default_factory=dict)
    openerKeys: list[str] = Field(default_factory=list)


def _run(state: dict) -> dict:
    from agent.graph import get_chain
    chain = get_chain()
    return chain.invoke(state)


def _format_analyse_response(result: dict) -> dict:
    brief = result.get("brief") or {}
    meta = {
        "credits_consumed": result.get("credits_consumed"),
        "companyFacts": result.get("company_facts"),
        "hiringTitles": result.get("hiring_titles") or [],
        "allRoles": result.get("all_roles") or [],
        "usedWebsite": bool(result.get("site_text")),
        "usedProfile": bool(result.get("linkedin_data")),
        "linkedInData": result.get("linkedin_data"),
        "tool_trace": result.get("tool_trace") or [],
        "validation": result.get("validation"),
        "plan_reasoning": result.get("plan_reasoning"),
        "planned_tools": result.get("planned_tools") or [],
    }
    out = {
        "mode": result.get("mode") or "agent",
        "person": brief.get("person", ""),
        "company": brief.get("company", ""),
        "needs": brief.get("needs") or [],
        "recentSignals": brief.get("recentSignals") or [],
        "keyFacts": brief.get("keyFacts") or [],
        "conversationPlaybook": brief.get("conversationPlaybook"),
        "fit": brief.get("fit") or {},
        "angle": brief.get("angle", ""),
        "signalKey": brief.get("signalKey", "default"),
        "customLine": brief.get("customLine", ""),
        "draftMessage": result.get("draft_message") or brief.get("draftMessage", ""),
        "summary": brief.get("summary", ""),
        **meta,
    }
    if result.get("error"):
        out["warning"] = result["error"]
    return out


@app.get("/health")
def health():
    from memory.mongo_memory import mongo_ok
    from mcp_server.bridge import BRIDGE_URL, call_tool_sync

    bridge_ok = False
    bridge_error = None
    try:
        bridge = call_tool_sync("GET", "list-openers", params={"track": "A"})
        bridge_ok = "error" not in bridge and bool(bridge.get("track") or bridge.get("keys"))
        if not bridge_ok:
            bridge_error = bridge.get("error") or "unexpected bridge response"
    except Exception as e:
        bridge_error = str(e)

    out = {
        "ok": True,
        "mongo_ok": mongo_ok(),
        "bridge_ok": bridge_ok,
        "bridge_url": BRIDGE_URL,
    }
    if bridge_error:
        out["bridge_error"] = bridge_error
    return out


def _build_analyse_state(req: AnalyseRequest, run_id: str) -> dict:
    return {
        "intent": "analyse",
        "prospect": req.prospect,
        "opener_keys": req.openerKeys,
        "extra_context": req.extraContext,
        "deep_research": req.deep,
        "pull_profile": req.pullProfile,
        "retry_count": 0,
        "max_retries": 2,
        "tool_trace": [],
        "tools_queue": [],
        "tools_completed": 0,
        "run_id": run_id,
    }


@app.post("/v1/analyse")
def analyse(req: AnalyseRequest):
    run_id = str(uuid.uuid4())[:8]
    logger.info('{"event":"analyse_start","run_id":"%s","prospect":"%s"}', run_id, req.prospect.get("name"))
    state = _build_analyse_state(req, run_id)
    try:
        result = _run(state)
        return _format_analyse_response(result)
    except Exception as e:
        logger.exception("analyse failed")
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/v1/analyse/stream")
async def analyse_stream(req: AnalyseRequest):
    from agent.streaming import graph_stream_analyse, sse_line

    run_id = str(uuid.uuid4())[:8]
    logger.info('{"event":"analyse_stream_start","run_id":"%s","prospect":"%s"}', run_id, req.prospect.get("name"))
    state = _build_analyse_state(req, run_id)

    async def generate():
        try:
            async for event in graph_stream_analyse(state, _format_analyse_response):
                yield sse_line(event)
            yield "data: [DONE]\n\n"
        except Exception as e:
            logger.exception("analyse stream failed")
            yield sse_line({"type": "error", "message": str(e)})

    return StreamingResponse(generate(), media_type="text/event-stream")


@app.post("/v1/classify")
def classify(req: ClassifyRequest):
    state = {
        "intent": "classify",
        "classify_text": req.text,
        "classify_url": req.url,
        "hint_track": req.hintTrack,
        "opener_map": req.openerMap,
        "tool_trace": [],
    }
    try:
        result = _run(state)
        return result.get("classify_result") or {"error": "classification failed"}
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@app.post("/v1/chat")
def chat(req: ChatRequest):
    state = {
        "intent": "chat",
        "thread_id": req.prospect_id,
        "prospect": req.prospect,
        "opener_keys": req.openerKeys,
        "chat_message": req.message,
        "extra_context": req.message,
        "pull_profile": False,
        "deep_research": False,
        "retry_count": 0,
        "max_retries": 1,
        "tool_trace": [],
    }
    try:
        result = _run(state)
        return {
            "reply": result.get("chat_reply") or "",
            "updated_brief": result.get("brief"),
            "draftMessage": result.get("draft_message"),
            "tool_trace": result.get("tool_trace") or [],
        }
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))
