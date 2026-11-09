#!/usr/bin/env bash
# One-command redeploy: ships the current commit to the VPS and rebuilds PayLink.
# Usage: deploy/deploy-vps.sh [ssh-host]   (default khalil-vps)
# Env stays on the host in /opt/paylink/secrets.env (mode 600); data in the paylink_paylink-data volume.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
HOST="${1:-khalil-vps}"
REV="$(git rev-parse --short HEAD)"
DIR="/opt/paylink/releases/$REV"
git archive --format=tar HEAD | ssh "$HOST" "rm -rf $DIR && mkdir -p $DIR && tar -x -C $DIR"
ssh "$HOST" "cd $DIR/deploy && PAYLINK_REVISION=$REV docker compose -f compose.coolify.yaml up -d --build && ln -sfn $DIR /opt/paylink/current"
echo "Deployed $REV to https://paylink.181labs.build"
