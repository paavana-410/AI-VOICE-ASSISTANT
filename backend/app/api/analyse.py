"""
api/analyse.py

POST /api/analyse          — on-demand structured analysis card
POST /api/analyse/auto     — called automatically after document upload
                             returns analyst-grade insight: KPIs, anomaly, recommendation
"""
from __future__ import annotations

import json
import re
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel

from app.auth import get_current_user_id
from app.agents.single_agent import get_llm
from langchain.messages import HumanMessage, SystemMessage

router = APIRouter()


# ── Response models ───────────────────────────────────────────────────────────

class TableCard(BaseModel):
    caption: str
    markdown: str
    page: int

class FigureCard(BaseModel):
    page: int
    description: str

class AnalysisCard(BaseModel):
    title:       str
    summary:     str
    key_facts:   list[str]
    tables:      list[TableCard]
    figures:     list[FigureCard]
    document_id: str

class AnalystInsight(BaseModel):
    """Analyst-grade insight card — auto-generated on document upload."""
    document_id:     str
    filename:        str
    title:           str
    assumptions:     list[str]       # stated assumptions before analysis
    kpis:            list[dict]      # [{"metric": "Revenue", "value": "₹15,663", "trend": "▲"}]
    finding:         str             # what the data shows
    anomalies:       list[str]       # unexpected patterns flagged
    impact:          str             # so what?
    recommendation:  str             # now what?
    confidence:      str             # High / Medium / Low + reason


# ── Request models ────────────────────────────────────────────────────────────

class AnalyseRequest(BaseModel):
    query: str
    document_id: Optional[str] = None

class AutoAnalyseRequest(BaseModel):
    document_id: str
    filename:    str


# ── Helpers ───────────────────────────────────────────────────────────────────

def _extract_json(raw: str) -> dict:
    """Strip markdown fences and parse JSON."""
    raw = raw.strip()
    if raw.startswith("```"):
        raw = re.sub(r"^```[a-z]*\n?", "", raw)
        raw = re.sub(r"\n?```$", "", raw)
    return json.loads(raw)


async def _get_doc_context(document_id: str, top_k: int = 15) -> tuple[str, list, list, list]:
    """Retrieve and format chunks for a document. Returns (context_str, text, tables, images)."""
    from app.documents.store import search_chunks, list_chunks
    chunks = await list_chunks(document_id)
    if not chunks:
        chunks = await search_chunks("business analysis", document_id=document_id, top_k=top_k)

    text_chunks  = [c for c in chunks if c.get("chunk_type") == "text"]
    table_chunks = [c for c in chunks if c.get("chunk_type") == "table"]
    img_chunks   = [c for c in chunks if c.get("chunk_type") == "image_caption"
                    and "unavailable" not in c.get("content", "")]

    ctx = ""
    if text_chunks:
        ctx += "TEXT:\n" + "\n\n".join(c["content"][:500] for c in text_chunks[:6])
    if table_chunks:
        ctx += "\n\nTABLES:\n" + "\n\n".join(
            f"[p{c.get('page_number','?')}]\n{c['content'][:1000]}" for c in table_chunks
        )
    if img_chunks:
        ctx += "\n\nFIGURES:\n" + "\n".join(
            f"p{c.get('page_number','?')}: {c['content'][:200]}" for c in img_chunks
        )
    return ctx, text_chunks, table_chunks, img_chunks


# ── Auto-analyst endpoint ─────────────────────────────────────────────────────

@router.post("/analyse/auto", response_model=AnalystInsight)
async def auto_analyse(
    req: AutoAnalyseRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Called automatically after a document is uploaded.
    Returns an analyst-grade insight card using the FIR framework.
    """
    ctx, _, table_chunks, _ = await _get_doc_context(req.document_id)
    if not ctx.strip():
        raise HTTPException(404, "No content found for this document.")

    prompt = f"""You are a senior business analyst. Analyse the document below and return a JSON object with EXACTLY this structure — no markdown fences, no explanation, only valid JSON:

{{
  "title": "short descriptive title of what this document is about",
  "assumptions": ["assumption 1 if query was ambiguous", "assumption 2 if needed"],
  "kpis": [
    {{"metric": "Total Revenue", "value": "₹15,663", "trend": "▲"}},
    {{"metric": "Top Department", "value": "Dept 2 — ₹3,398", "trend": "▲"}},
    {{"metric": "Weakest Unit", "value": "Dept 3 — ₹2,724", "trend": "▼"}}
  ],
  "finding": "precise 2-sentence statement of what the data shows, with numbers",
  "anomalies": ["unexpected pattern 1 with data", "unexpected pattern 2 if present"],
  "impact": "what this finding means for the business — so what?",
  "recommendation": "one specific, actionable recommendation — now what?",
  "confidence": "High — based on complete quarterly data across all departments"
}}

Rules:
- kpis: extract 3-5 real metrics from the document with actual values
- finding: use exact numbers from the document
- anomalies: flag anything unexpected even if not asked
- confidence: High if full data present, Medium if partial, Low if inferred
- Use ▲ for positive trend, ▼ for negative, → for flat

DOCUMENT CONTENT:
{ctx[:4000]}"""

    try:
        llm = get_llm()
        if llm is None:
            raise HTTPException(503, "LLM unavailable")
        response = llm.invoke([
            SystemMessage(content="You are a precise business analyst. Return only valid JSON."),
            HumanMessage(content=prompt),
        ])
        data = _extract_json(response.content)
    except HTTPException:
        raise
    except json.JSONDecodeError as e:
        raise HTTPException(500, f"LLM returned invalid JSON: {e}")
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")

    return AnalystInsight(
        document_id=req.document_id,
        filename=req.filename,
        title=data.get("title", req.filename),
        assumptions=data.get("assumptions", []),
        kpis=data.get("kpis", []),
        finding=data.get("finding", ""),
        anomalies=data.get("anomalies", []),
        impact=data.get("impact", ""),
        recommendation=data.get("recommendation", ""),
        confidence=data.get("confidence", "Medium"),
    )


# ── On-demand analysis endpoint (existing, kept) ─────────────────────────────

@router.post("/analyse", response_model=AnalysisCard)
async def analyse_document(
    req: AnalyseRequest,
    user_id: str = Depends(get_current_user_id),
):
    """On-demand structured analysis card for a document."""
    try:
        from app.documents.store import search_chunks
        chunks = await search_chunks(req.query, document_id=req.document_id, top_k=12)
    except Exception as e:
        raise HTTPException(503, f"Document store unavailable: {e}")

    if not chunks:
        raise HTTPException(404, "No document content found.")

    text_chunks  = [c for c in chunks if c.get("chunk_type") == "text"]
    table_chunks = [c for c in chunks if c.get("chunk_type") == "table"]
    img_chunks   = [c for c in chunks if c.get("chunk_type") == "image_caption"
                    and "unavailable" not in c.get("content", "")]

    doc_text = ""
    if text_chunks:
        doc_text += "TEXT:\n" + "\n\n".join(c["content"][:400] for c in text_chunks[:5])
    if table_chunks:
        doc_text += "\n\nTABLES:\n" + "\n\n".join(
            f"Table p{c.get('page_number','?')}:\n{c['content'][:800]}" for c in table_chunks
        )

    prompt = f"""Analyse the document and return JSON with this exact structure:
{{
  "title": "document title",
  "summary": "2-3 sentence executive summary",
  "key_facts": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5"],
  "tables": [{{"caption": "what this table shows", "page": 1}}],
  "figures": [{{"page": 1, "description": "what this figure shows"}}]
}}

Return ONLY valid JSON. No markdown fences.

DOCUMENT:
{doc_text[:3000]}

QUERY: {req.query}"""

    try:
        llm = get_llm()
        response = llm.invoke([
            SystemMessage(content="You are a precise document analyst. Return only valid JSON."),
            HumanMessage(content=prompt),
        ])
        data = _extract_json(response.content)
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")

    tables_out = []
    for i, tc in enumerate(table_chunks):
        caption = data.get("tables", [{}])[i].get("caption", f"Table {i+1}") if i < len(data.get("tables", [])) else f"Table {i+1}"
        tables_out.append(TableCard(caption=caption, markdown=tc["content"], page=tc.get("page_number", 0)))

    figures_out = [
        FigureCard(page=ic.get("page_number", 0), description=ic["content"][:200])
        for ic in img_chunks
    ] or [
        FigureCard(page=f.get("page", 0), description=f.get("description", ""))
        for f in data.get("figures", [])
    ]

    return AnalysisCard(
        title=data.get("title", req.query),
        summary=data.get("summary", ""),
        key_facts=data.get("key_facts", [])[:8],
        tables=tables_out,
        figures=figures_out,
        document_id=chunks[0].get("document_id", "") if chunks else "",
    )
