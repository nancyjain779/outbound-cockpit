"""Shared LLM JSON helpers."""
from __future__ import annotations

import json
import re


def extract_json(text: str) -> dict | None:
    if not text:
        return None
    m = re.search(r"\{[\s\S]*\}", text)
    if not m:
        return None
    try:
        return json.loads(m.group())
    except json.JSONDecodeError:
        return None


def llm_json(system: str, user: str) -> dict | None:
    try:
        import os
        import litellm
        model = os.getenv("LITELLM_MODEL", os.getenv("OPENAI_MODEL", "gpt-4o-mini"))
        resp = litellm.completion(
            model=model,
            messages=[{"role": "system", "content": system}, {"role": "user", "content": user}],
            temperature=0.4,
            response_format={"type": "json_object"},
        )
        return extract_json(resp.choices[0].message.content or "")
    except Exception:
        return None
