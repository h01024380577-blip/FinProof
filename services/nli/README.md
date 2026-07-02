# finproof-nli

mDeBERTa-v3-base-mnli-xnli 기반 cross-lingual NLI 서비스. `enrichSemanticPreservation()`가 호출한다.

## 로컬 실행
    python -m venv .venv && source .venv/bin/activate
    pip install -r requirements.txt
    uvicorn app:app --host 127.0.0.1 --port 8001

## API
- `GET /health`
- `POST /nli` — body `{ premise, hypothesis }` → `{ scores: { entailment, neutral, contradiction } }`

## 배포 (EC2, finproof-ocr 패턴)
    sudo cp finproof-nli.service /etc/systemd/system/
    sudo systemctl daemon-reload
    sudo systemctl enable --now finproof-nli
    curl -s localhost:8001/health

앱 쪽 활성화: `FINPROOF_NLI_ENABLED=true`, `FINPROOF_NLI_URL=http://127.0.0.1:8001`.
