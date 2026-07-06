"""Golden eval runner — compare agent vs legacy heuristic."""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from agent.graph import get_chain


def run_case(case: dict) -> dict:
    state = {
        "intent": "analyse",
        "prospect": case["prospect"],
        "opener_keys": case.get("openerKeys", ["default"]),
        "extra_context": "",
        "deep_research": False,
        "pull_profile": False,
        "retry_count": 0,
        "max_retries": 1,
        "tool_trace": [],
    }
    result = get_chain().invoke(state)
    brief = result.get("brief") or {}
    validation = result.get("validation") or {}
    return {
        "id": case.get("id"),
        "has_brief": bool(brief.get("draftMessage") or result.get("draft_message")),
        "validation_pass": validation.get("pass"),
        "tool_count": len(result.get("tool_trace") or []),
        "mode": result.get("mode"),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--golden", default=str(Path(__file__).parent / "golden_set.json"))
    args = parser.parse_args()
    cases = json.loads(Path(args.golden).read_text())
    results = [run_case(c) for c in cases]
    passed = sum(1 for r in results if r["has_brief"])
    validated = sum(1 for r in results if r.get("validation_pass"))
    print(json.dumps({"total": len(results), "brief_ok": passed, "validation_pass": validated, "results": results}, indent=2))


if __name__ == "__main__":
    main()
