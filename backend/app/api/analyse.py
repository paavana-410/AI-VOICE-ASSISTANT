"""
api/analyse.py — POST /api/analyse

Returns a structured JSON analysis card for an uploaded document.
Used by the frontend to render rich analysis cards in chat.

Response schema:
{
  "title":      str,
  "summary":    str,
  "key_facts":  [str],
  "tables":     [{"caption": str, "markdown": str}],
  "figures":    [{"page": int, "description": str}],
  "document_id": str
}
"""
from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from typing import Optional

from app.auth import get_current_user_id
from app.agents.single_agent import get_llm
from langchain.messages import HumanMessage, SystemMessage

router = APIRouter()


class AnalyseRequest(BaseModel):
    query: str                    # what to analyse / summarise
    document_id: Optional[str] = None   # scope to a specific doc if provided


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


@router.post("/analyse", response_model=AnalysisCard)
async def analyse_document(
    req: AnalyseRequest,
    user_id: str = Depends(get_current_user_id),
):
    """
    Retrieve relevant chunks from uploaded documents and ask the LLM
    to produce a structured analysis card in JSON format.
    """
    # ── Retrieve chunks ───────────────────────────────────────────────────────
    try:
        from app.documents.store import search_chunks
        chunks = await search_chunks(req.query, document_id=req.document_id, top_k=12)
    except Exception as e:
        raise HTTPException(503, f"Document store unavailable: {e}")

    if not chunks:
        raise HTTPException(404, "No document content found for this query.")

    # ── Separate by type ──────────────────────────────────────────────────────
    text_chunks  = [c for c in chunks if c.get("chunk_type") == "text"]
    table_chunks = [c for c in chunks if c.get("chunk_type") == "table"]
    img_chunks   = [c for c in chunks if c.get("chunk_type") == "image_caption"
                    and "unavailable" not in c.get("content", "")
                    and "[Image on page" not in c.get("content", "")]

    # ── Build context for LLM ─────────────────────────────────────────────────
    doc_text = ""
    if text_chunks:
        doc_text += "TEXT CONTENT:\n" + "\n\n".join(c["content"][:400] for c in text_chunks[:5])
    if table_chunks:
        doc_text += "\n\nTABLES:\n" + "\n\n".join(
            f"Table (p{c.get('page_number','?')}):\n{c['content'][:800]}"
            for c in table_chunks
        )
    if img_chunks:
        doc_text += "\n\nFIGURES:\n" + "\n".join(
            f"p{c.get('page_number','?')}: {c['content'][:200]}"
            for c in img_chunks
        )

    # ── Ask LLM for structured JSON ───────────────────────────────────────────
    prompt = f"""Analyse the following document content and return a JSON object with EXACTLY this structure:
{{
  "title": "short descriptive title of the document",
  "summary": "2-3 sentence executive summary",
  "key_facts": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5"],
  "tables": [{{"caption": "what this table shows", "page": 4}}],
  "figures": [{{"page": 2, "description": "what this figure shows"}}]
}}

Return ONLY valid JSON. No markdown fences. No explanation.

DOCUMENT CONTENT:
{doc_text[:3000]}

USER QUERY: {req.query}"""

    try:
        llm = get_llm()
        response = llm.invoke([
            SystemMessage(content="You are a precise document analyst. Return only valid JSON."),
            HumanMessage(content=prompt),
        ])
        raw = response.content.strip()
        # Strip markdown fences if present
        if raw.startswith("```"):
            raw = raw.split("```")[1]
            if raw.startswith("json"):
                raw = raw[4:]
        import json
        data = json.loads(raw)
    except Exception as e:
        raise HTTPException(500, f"Analysis failed: {e}")

    # ── Build tables with full markdown content ───────────────────────────────
    tables_out = []
    for i, tc in enumerate(table_chunks):
        caption = ""
        if "tables" in data and i < len(data.get("tables", [])):
            caption = data["tables"][i].get("caption", f"Table {i+1}")
        else:
            caption = f"Table {i+1}"
        tables_out.append(TableCard(
            caption=caption,
            markdown=tc["content"],
            page=tc.get("page_number", 0),
        ))

    figures_out = []
    for ic in img_chunks:
        fig_data = {"page": ic.get("page_number", 0), "description": ic["content"][:200]}
        figures_out.append(FigureCard(**fig_data))

    # Also add LLM-described figures (from data) if no real image captions
    if not figures_out and data.get("figures"):
        for f in data["figures"]:
            figures_out.append(FigureCard(
                page=f.get("page", 0),
                description=f.get("description", ""),
            ))

    doc_id = chunks[0].get("document_id", "") if chunks else ""

    return AnalysisCard(
        title=data.get("title", req.query),
        summary=data.get("summary", ""),
        key_facts=data.get("key_facts", [])[:8],
        tables=tables_out,
        figures=figures_out,
        document_id=doc_id,
    )
