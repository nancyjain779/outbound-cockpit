"""Prompts ported from api/ai/analyse.js — VOICE, anti-patterns, track context."""
from __future__ import annotations

import json
import os

VOICE_NAME = os.getenv("OUTREACH_VOICE_NAME", "the operator")
COMPANY_NAME = os.getenv("OUTBOUND_COMPANY_NAME", "your team")

VOICE = f"""VOICE & PERSONALITY:
- You are {VOICE_NAME}: a senior engineer-operator at {COMPANY_NAME}. Warm, direct, genuinely curious, peer-to-peer — never vendor-to-lead.
- Sound unmistakably human: natural rhythm, plain words, contractions, one clear thought.
- Reference ONE concrete, real, specific thing from their posts/profile/company.
- Be humble and curious — exploring with them, not diagnosing from outside."""

MESSAGE_DONTS = """NEVER in the message:
- No pitching, no 'we build / we help', no case studies, no 'companies like yours'.
- No CTA: no 'book a call', 'grab 15 minutes', calendar links.
- No flattery ('brilliant post', 'huge fan', 'impressive work').
- No corporate/AI filler: 'hope this finds you well', 'leverage', 'synergies', 'touch base'.
- No placeholders, no emoji spam, no hashtags."""

OUTBOUND_CAPS = os.getenv(
    "OUTBOUND_OFFER_CONTEXT",
    "Your team's capabilities (context only — do NOT pitch): (1) AI products with eval/RAG/observability; "
    "(2) fractional technical team for founders; (3) SOC2/ISO compliance for enterprise AI; "
    "(4) paid Build Plan for non-technical founders.",
)

TRACK_CONTEXT = {
    "A": "Funded SaaS/AI founder or CTO scaling under real users and enterprise scrutiny.",
    "B": "Enterprise innovation leader shipping AI inside regulated workflows.",
    "C": "First-time founder with capital trying to get from idea to launched MVP.",
    "D": "Idea-stage / non-technical founder wrestling with scope, cost, and who to trust.",
}


def build_analyse_prompt(
    prospect: dict,
    opener_keys: list[str],
    facts: dict | None,
    hiring_titles: list[str],
    all_roles: list[str],
    site_text: str,
    linkedin_block: str,
    user_paste: str,
    web_summary: str,
) -> str:
    track = (prospect.get("track") or "A").upper()
    ctx = TRACK_CONTEXT.get(track, TRACK_CONTEXT["A"])
    parts = [
        f"You are reaching out as a peer from {COMPANY_NAME} — NOT a salesperson. Produce an ANALYSIS BRIEF and opening MESSAGE.",
        "",
        VOICE,
        "",
        OUTBOUND_CAPS,
        "",
        f"Their world: {ctx}",
        "",
        f"Prospect: {prospect.get('name')} @ {prospect.get('company')} | track {track}",
        f"Signal: {prospect.get('signal', '')}",
        f"Profile: {prospect.get('profile', '')}",
    ]
    if facts:
        parts.append(f"Company facts: {json.dumps(facts, default=str)[:1500]}")
    if hiring_titles:
        parts.append(f"Open engineering roles: {', '.join(hiring_titles)}")
    if all_roles:
        parts.append(f"All open roles: {', '.join(all_roles)}")
    if site_text:
        parts.append(f"Website excerpt:\n{site_text[:2000]}")
    if linkedin_block:
        parts.append(f"LinkedIn scrape:\n{linkedin_block[:2500]}")
    if user_paste:
        parts.append(f"User paste:\n{user_paste[:1500]}")
    if web_summary:
        parts.append(f"Web research:\n{web_summary[:2500]}")
    parts.extend([
        "",
        f"Valid opener keys: {', '.join(opener_keys) if opener_keys else 'default'}",
        "",
        "Opening message: 40-85 words, human peer voice, one specific observation + one sincere question, no pitch.",
        MESSAGE_DONTS,
        "",
        'Return STRICT JSON: {"person":"","company":"","needs":[],"recentSignals":[],"keyFacts":[],'
        '"conversationPlaybook":{"whatTheyCareAbout":"","listenFor":[],"goodFollowUpQuestions":[],'
        '"ifTheyReply":"","watchOut":""},'
        '"fit":{"score":0,"label":"","whereWeFit":"","whyNow":""},'
        '"angle":"","signalKey":"","customLine":"","draftMessage":"","summary":""}',
    ])
    return "\n".join(parts)


def build_classify_prompt(text: str, url: str, hint_track: str, opener_map: dict) -> str:
    map_lines = "\n".join(f"  {t}: {', '.join(v)}" for t, v in opener_map.items())
    return f"""Triage social post for founder-led outbound.
Tracks: A=funded SaaS/AI; B=enterprise innovation; C=first-time founder WITH capital; D=idea-stage.
Openers:
{map_lines}
Hint: {hint_track or 'none'}
URL: {url or 'none'}
Text:
\"\"\"
{text[:4000]}
\"\"\"
Return STRICT JSON: {{"track":"A|B|C|D","signalKey":"","signal":"","nameGuess":"","customLine":"","summary":""}}"""


def build_validate_prompt(draft: str, track: str) -> str:
    return f"""Judge outreach draft (track {track}) against rules. FAIL if pitching, CTA, flattery, filler, placeholders.
Draft:
\"\"\"
{draft[:2000]}
\"\"\"
Return STRICT JSON: {{"pass": true/false, "score": 0-100, "issues": [], "suggestion": ""}}"""
