"""LangChain adapter for AutoCompare XML suggestion generation.

Provider order is configurable, but defaults to local Ollama first,
with OpenAI as an optional fallback.
"""

from __future__ import annotations

import os
import re
import importlib
from typing import Optional

import lxml.etree as etree


def _strip_code_fences(text: str) -> str:
    cleaned = text.strip()
    cleaned = re.sub(r"^```(?:xml)?\\s*", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\\s*```$", "", cleaned)
    return cleaned.strip()


def _validate_xml(xml_text: str) -> None:
    parser = etree.XMLParser(recover=False)
    etree.fromstring(xml_text.encode("utf-8"), parser=parser)


def _build_prompt_messages() -> tuple[str, str]:
    system = (
        "You are an XML editor for legal/regulatory documents. "
        "Update XML safely from OLD vs NEW text deltas. "
        "Return only valid XML and preserve structure/attributes unless change is required."
    )
    human = (
        "XML_CHUNK:\n{xml_chunk}\n\n"
        "OLD_PDF_TEXT:\n{old_pdf_text}\n\n"
        "NEW_PDF_TEXT:\n{new_pdf_text}\n\n"
        "FOCUS_OLD_TEXT:\n{focus_old_text}\n\n"
        "FOCUS_NEW_TEXT:\n{focus_new_text}\n\n"
        "FOCUS_TEXT:\n{focus_text}\n\n"
        "Task: update XML_CHUNK to reflect NEW_PDF_TEXT changes. "
        "If no change is needed, return XML_CHUNK unchanged."
    )
    return system, human


def _invoke_with_ollama(inputs: dict[str, str]) -> tuple[str, dict]:
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate
    ollama_module = importlib.import_module("langchain_ollama")
    ChatOllama = getattr(ollama_module, "ChatOllama")

    model_name = os.getenv("AUTOCOMPARE_LANGCHAIN_OLLAMA_MODEL", "qwen2.5:7b-instruct")
    base_url = os.getenv("AUTOCOMPARE_LANGCHAIN_OLLAMA_BASE_URL", "http://localhost:11434")

    system, human = _build_prompt_messages()
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("human", human),
    ])

    llm = ChatOllama(model=model_name, base_url=base_url, temperature=0)
    chain = prompt | llm | StrOutputParser()
    out = chain.invoke(inputs)
    return out, {"provider": "ollama", "model": model_name}


def _invoke_with_openai(inputs: dict[str, str]) -> tuple[str, dict]:
    from langchain_core.output_parsers import StrOutputParser
    from langchain_core.prompts import ChatPromptTemplate
    openai_module = importlib.import_module("langchain_openai")
    ChatOpenAI = getattr(openai_module, "ChatOpenAI")

    model_name = os.getenv("AUTOCOMPARE_LANGCHAIN_OPENAI_MODEL", "gpt-4o-mini")

    system, human = _build_prompt_messages()
    prompt = ChatPromptTemplate.from_messages([
        ("system", system),
        ("human", human),
    ])

    llm = ChatOpenAI(model=model_name, temperature=0)
    chain = prompt | llm | StrOutputParser()
    out = chain.invoke(inputs)
    return out, {"provider": "openai", "model": model_name}


def generate_xml_suggestion_langchain(
    xml_chunk: str,
    old_pdf_text: str,
    new_pdf_text: str,
    focus_old_text: Optional[str] = None,
    focus_new_text: Optional[str] = None,
    focus_text: Optional[str] = None,
) -> tuple[str, dict]:
    """Generate XML suggestions using provider priority.

    Env flags:
      - AUTOCOMPARE_LANGCHAIN_PROVIDER: ollama|openai|auto (default: ollama)
      - AUTOCOMPARE_LANGCHAIN_OPENAI_FALLBACK: true|false (default: true)
    """

    provider = os.getenv("AUTOCOMPARE_LANGCHAIN_PROVIDER", "ollama").strip().lower()
    allow_openai_fallback = os.getenv("AUTOCOMPARE_LANGCHAIN_OPENAI_FALLBACK", "true").strip().lower() in {
        "1", "true", "yes", "on"
    }

    inputs = {
        "xml_chunk": xml_chunk,
        "old_pdf_text": old_pdf_text,
        "new_pdf_text": new_pdf_text,
        "focus_old_text": focus_old_text or "",
        "focus_new_text": focus_new_text or "",
        "focus_text": focus_text or "",
    }

    def _finalize(raw: str, meta: dict) -> tuple[str, dict]:
        suggested_xml = _strip_code_fences(raw)
        _validate_xml(suggested_xml)
        return suggested_xml, meta

    if provider in {"ollama", "auto"}:
        try:
            raw, meta = _invoke_with_ollama(inputs)
            return _finalize(raw, meta)
        except Exception:
            if provider == "ollama" and not allow_openai_fallback:
                raise

    if provider in {"openai", "auto"} or allow_openai_fallback:
        raw, meta = _invoke_with_openai(inputs)
        return _finalize(raw, meta)

    raise RuntimeError("No LangChain provider available for autocompare")
