#!/usr/bin/env bash
#
# Provisions the FinProof OCR microservice (ocr-service/) on the EC2 host.
# Run this ON the box:  ssh finproof-seoul, then `bash provision-ocr-service.sh`.
#
# Idempotent. Safe to re-run after every deploy. Does NOT change OCR behavior on
# its own — it only stands the service up on 127.0.0.1:8000. Flipping the app to
# the `hybrid` provider is a separate, explicit step (see the bottom of this file).
#
# tesseract is intentionally NOT required: the `hybrid` provider routes images and
# scanned PDFs to the OpenAI vision model, so the Python service only needs
# pymupdf / pdfplumber / python-docx (all in requirements.txt).
set -euo pipefail

VENV=/opt/finproof-ocr/venv                       # stable path — survives deploy rsync
APP_DIR=/opt/finproof-agent/current/ocr-service   # deployed service source (symlinked release)

echo "==> venv + deps at ${VENV}"
sudo mkdir -p /opt/finproof-ocr
sudo chown "$(id -un)":"$(id -gn)" /opt/finproof-ocr
[ -d "${VENV}" ] || python3 -m venv "${VENV}"
"${VENV}/bin/pip" install --upgrade pip -q
"${VENV}/bin/pip" install -q -r "${APP_DIR}/requirements.txt"

echo "==> systemd unit /etc/systemd/system/finproof-ocr.service"
sudo tee /etc/systemd/system/finproof-ocr.service >/dev/null <<UNIT
[Unit]
Description=FinProof OCR microservice (pymupdf/pdfplumber/python-docx)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=ec2-user
WorkingDirectory=${APP_DIR}
ExecStart=${VENV}/bin/uvicorn app.main:app --host 127.0.0.1 --port 8000
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
UNIT

echo "==> enable + start"
sudo systemctl daemon-reload
sudo systemctl enable --now finproof-ocr
sleep 2

echo "==> health check"
curl -fsS http://127.0.0.1:8000/health && echo "  <- OCR service healthy on :8000" || {
  echo "  !! health check failed — check: sudo journalctl -u finproof-ocr -n 50"
  exit 1
}

cat <<'NEXT'

------------------------------------------------------------------------------
서비스가 떴습니다. 아직 OCR 동작은 안 바뀌었습니다(prod는 여전히 openai).
hybrid로 전환하려면 (prod OCR 동작 변경 — 비가역):

  sudo sed -i 's/^FINPROOF_OCR_PROVIDER=.*/FINPROOF_OCR_PROVIDER=hybrid/' \
    /etc/finproof-agent/finproof-agent.env
  grep -q '^FINPROOF_OCR_ENDPOINT=' /etc/finproof-agent/finproof-agent.env \
    && sudo sed -i 's#^FINPROOF_OCR_ENDPOINT=.*#FINPROOF_OCR_ENDPOINT=http://localhost:8000#' \
         /etc/finproof-agent/finproof-agent.env \
    || echo 'FINPROOF_OCR_ENDPOINT=http://localhost:8000' \
         | sudo tee -a /etc/finproof-agent/finproof-agent.env
  sudo systemctl restart finproof-agent finproof-agent-analysis-worker

롤백 (openai로 복귀):

  sudo sed -i 's/^FINPROOF_OCR_PROVIDER=.*/FINPROOF_OCR_PROVIDER=openai/' \
    /etc/finproof-agent/finproof-agent.env
  sudo systemctl restart finproof-agent finproof-agent-analysis-worker
------------------------------------------------------------------------------
NEXT
