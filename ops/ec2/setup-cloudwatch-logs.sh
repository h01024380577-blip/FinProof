#!/usr/bin/env bash
#
# setup-cloudwatch-logs.sh
# Ships finproof-agent + analysis-worker stdout/stderr to CloudWatch Logs.
# Run ON the EC2 host (Amazon Linux 2023) as a sudo-capable user.
#
# Prerequisite (done once in the AWS console, NOT by this script):
#   The EC2 instance must have an IAM instance profile whose role includes
#   the managed policy `CloudWatchAgentServerPolicy`. Without it the agent
#   starts but cannot push logs (you'll see AccessDenied in the agent log).
#
# Idempotent: safe to re-run.
set -euo pipefail

REPO_DIR="${REPO_DIR:-/opt/finproof-agent/current}"
LOG_DIR="/var/log/finproof"
SVC_USER="${SVC_USER:-finproof}"
SVC_GROUP="${SVC_GROUP:-finproof}"
CWA_CONFIG_SRC="${REPO_DIR}/ops/ec2/cloudwatch-agent-config.json"
CWA_CONFIG_DST="/opt/aws/amazon-cloudwatch-agent/etc/finproof-cloudwatch.json"

echo "==> 1. Installing amazon-cloudwatch-agent (if missing)"
if ! command -v amazon-cloudwatch-agent-ctl >/dev/null 2>&1 \
   && [ ! -x /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl ]; then
  sudo dnf install -y amazon-cloudwatch-agent
else
  echo "    already installed"
fi

echo "==> 2. Creating log directory ${LOG_DIR} (owned by ${SVC_USER})"
sudo mkdir -p "${LOG_DIR}"
sudo chown "${SVC_USER}:${SVC_GROUP}" "${LOG_DIR}"
sudo chmod 750 "${LOG_DIR}"

echo "==> 3. Installing systemd drop-ins (stdout/stderr -> files)"
sudo mkdir -p /etc/systemd/system/finproof-agent.service.d
sudo mkdir -p /etc/systemd/system/finproof-agent-analysis-worker.service.d
sudo cp "${REPO_DIR}/ops/ec2/finproof-agent.logging.conf" \
        /etc/systemd/system/finproof-agent.service.d/logging.conf
sudo cp "${REPO_DIR}/ops/ec2/finproof-agent-analysis-worker.logging.conf" \
        /etc/systemd/system/finproof-agent-analysis-worker.service.d/logging.conf
sudo systemctl daemon-reload

echo "==> 4. Installing CloudWatch Agent config and starting it"
sudo mkdir -p "$(dirname "${CWA_CONFIG_DST}")"
sudo cp "${CWA_CONFIG_SRC}" "${CWA_CONFIG_DST}"
sudo /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl \
  -a fetch-config -m ec2 -s -c "file:${CWA_CONFIG_DST}"

echo "==> 5. Restarting services so stdout redirection takes effect"
sudo systemctl restart finproof-agent.service
sudo systemctl restart finproof-agent-analysis-worker.service

echo ""
echo "Done. Verify with:"
echo "  amazon-cloudwatch-agent-ctl -a status"
echo "  tail -f ${LOG_DIR}/analysis-worker.log"
echo "  aws logs tail /finproof/analysis-worker --follow --region ap-northeast-2"
