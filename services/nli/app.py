from functools import lru_cache

import torch
from fastapi import FastAPI
from pydantic import BaseModel
from transformers import AutoModelForSequenceClassification, AutoTokenizer

MODEL_NAME = "MoritzLaurer/mDeBERTa-v3-base-mnli-xnli"

app = FastAPI(title="finproof-nli")


class NliRequest(BaseModel):
    premise: str
    hypothesis: str


@lru_cache(maxsize=1)
def _model():
    tokenizer = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForSequenceClassification.from_pretrained(MODEL_NAME)
    model.eval()
    return tokenizer, model


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/nli")
def nli(request: NliRequest):
    tokenizer, model = _model()
    inputs = tokenizer(
        request.premise,
        request.hypothesis,
        truncation=True,
        return_tensors="pt",
        max_length=512,
    )
    with torch.no_grad():
        logits = model(**inputs).logits[0]
    probs = torch.softmax(logits, dim=-1).tolist()

    label_map = model.config.id2label
    scores = {label_map[i].lower(): float(probs[i]) for i in range(len(probs))}

    return {
        "scores": {
            "entailment": scores.get("entailment", 0.0),
            "neutral": scores.get("neutral", 0.0),
            "contradiction": scores.get("contradiction", 0.0),
        }
    }
