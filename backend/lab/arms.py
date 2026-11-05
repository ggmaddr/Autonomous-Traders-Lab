"""The options an experiment can vary. An arm is one value per dimension; an
experiment runs every combination of the values chosen, on every chosen scenario,
k times each.
"""

import requests

from local_llm import MODEL_NAME, OLLAMA_BASE_URL
from ..reset import cathie_strategy, george_strategy, ray_strategy, warren_strategy

STRATEGIES = {
    "value": ("Warren", "Value, patient", warren_strategy),
    "macro": ("George", "Macro, contrarian", george_strategy),
    "risk_parity": ("Ray", "Risk parity, systematic", ray_strategy),
    "thematic": ("Cathie", "Disruptive growth", cathie_strategy),
}

STATIC = [
    {
        "id": "researcher",
        "label": "Researcher",
        "question": "Does research earn its cost? (E1, E2)",
        "values": [
            {"id": "on_demand", "label": "On demand", "detail": "The trader calls the Researcher when it chooses, as on the live floor"},
            {"id": "off", "label": "Off", "detail": "No research at all: prices and the account only"},
            {"id": "forced", "label": "Always first", "detail": "The Researcher runs before the trader, and its report is in the prompt"},
            {"id": "digest", "label": "Digest", "detail": "The scenario's news pasted into the prompt; no research calls, no research cost"},
        ],
        "default": ["on_demand", "off"],
    },
    {
        "id": "prompt",
        "label": "Prompt",
        "question": "Do prompts that name missing tools cost anything? (E10)",
        "values": [
            {"id": "fixed", "label": "Fixed", "detail": "Names only the tools the arm has"},
            {"id": "original", "label": "Original", "detail": "The baseline prompt, which names memory, news, push and strategy tools that do not exist (D11)"},
        ],
        "default": ["fixed"],
    },
    {
        "id": "strategy",
        "label": "Strategy",
        "question": "Do the personas decide differently on the same evidence? (E3)",
        "values": [{"id": k, "label": v[1], "detail": f"{v[0]}'s strategy text"} for k, v in STRATEGIES.items()],
        "default": ["value"],
    },
]


def models() -> list[str]:
    """Models Ollama has pulled, the live traders' model first."""
    try:
        tags = requests.get(OLLAMA_BASE_URL.replace("/v1", "/api/tags"), timeout=2).json()
        names = sorted(m["name"] for m in tags.get("models", []) if "embed" not in m["name"])
    except Exception:
        names = []
    return sorted(set(names) | {MODEL_NAME}, key=lambda n: (n != MODEL_NAME, n))


def model_digests() -> dict[str, str]:
    try:
        tags = requests.get(OLLAMA_BASE_URL.replace("/v1", "/api/tags"), timeout=2).json()
        return {m["name"]: m.get("digest", "")[:12] for m in tags.get("models", [])}
    except Exception:
        return {}


def dimensions() -> list[dict]:
    model_dim = {
        "id": "model",
        "label": "Model",
        "question": "Where is each model on the cost and quality frontier? (E6)",
        "values": [{"id": m, "label": m, "detail": "Live traders' model" if m == MODEL_NAME else "Pulled in Ollama"} for m in models()],
        "default": [MODEL_NAME],
    }
    return [STATIC[0], model_dim, *STATIC[1:]]


DIMENSION_IDS = ["researcher", "model", "prompt", "strategy"]


def arm_id(arm: dict) -> str:
    return "|".join(f"{d}={arm[d]}" for d in DIMENSION_IDS)


def combinations(chosen: dict[str, list[str]]) -> list[dict]:
    arms = [{}]
    for d in DIMENSION_IDS:
        arms = [{**a, d: v} for a in arms for v in chosen[d]]
    return arms


def validate(chosen: dict[str, list[str]]) -> str | None:
    """None if every dimension has at least one known value."""
    known = {d["id"]: {v["id"] for v in d["values"]} for d in dimensions()}
    for d in DIMENSION_IDS:
        values = chosen.get(d) or []
        if not values:
            return f"Choose at least one {d}"
        unknown = set(values) - known[d]
        if unknown:
            return f"Unknown {d}: {', '.join(sorted(unknown))}"
    return None
