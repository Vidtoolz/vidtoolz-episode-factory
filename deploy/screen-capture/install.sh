#!/usr/bin/env bash
# Screen Capture V1 — identity-separated trust anchor deployment (vidnux).
# Idempotent. Requires root and explicit operator authorization. Does not start
# any capture and does not change config/screen-capture-policy.json.
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then echo "install.sh must run as root (sudo) — refusing" >&2; exit 2; fi
if [ "${VIDTOOLZ_DEPLOY_AUTHORIZED:-}" != "yes" ]; then echo "set VIDTOOLZ_DEPLOY_AUTHORIZED=yes after Mikko has authorized this deployment step" >&2; exit 3; fi

EVIDENCE_ROOT=/var/lib/vidtoolz-evidence
CAPTURE_STATE=/var/lib/vidtoolz-capture
SPOOL=/run/vidtoolz-capture/spool
REPO=${VIDTOOLZ_EF_ROOT:-/home/vidtoolz/vidtoolz-episode-factory}

# identities: no login, no home, no sudo, no docker
for u in vidtoolz-capture vidtoolz-evidence; do
  if ! id "$u" >/dev/null 2>&1; then useradd --system --no-create-home --shell /usr/sbin/nologin "$u"; fi
  if id -nG "$u" | grep -qw docker; then gpasswd -d "$u" docker; fi
done
getent group vidtoolz-evidence-readers >/dev/null || groupadd --system vidtoolz-evidence-readers
usermod -aG vidtoolz-evidence-readers vidtoolz
usermod -aG vidtoolz-evidence-readers vidtoolz-capture

# protected evidence store (finalizer-owned, readers group read-only)
install -d -m 0750 -o vidtoolz-evidence -g vidtoolz-evidence-readers "$EVIDENCE_ROOT"
install -d -m 0700 -o vidtoolz-evidence -g vidtoolz-evidence "$EVIDENCE_ROOT/keys"
install -d -m 0750 -o vidtoolz-evidence -g vidtoolz-evidence-readers "$EVIDENCE_ROOT/receipts"
if [ ! -f "$EVIDENCE_ROOT/keys/evidence-finalizer-ed25519.pem" ]; then
  runuser -u vidtoolz-evidence -- node -e "require('$REPO/screen-capture/evidence-store.js').generateSigningKey('$EVIDENCE_ROOT/keys/evidence-finalizer-ed25519.pem')"
fi
chmod 0600 "$EVIDENCE_ROOT/keys/evidence-finalizer-ed25519.pem"

# capture worker state + transient spool (tmpfs, 0700)
install -d -m 0700 -o vidtoolz-capture -g vidtoolz-capture "$CAPTURE_STATE" "$CAPTURE_STATE/profiles"
install -d -m 0700 -o vidtoolz-capture -g vidtoolz-capture /run/vidtoolz-capture
if ! mountpoint -q "$SPOOL"; then install -d -m 0700 -o vidtoolz-capture -g vidtoolz-capture "$SPOOL"; mount -t tmpfs -o size=2g,mode=0700,uid=vidtoolz-capture,gid=vidtoolz-capture tmpfs "$SPOOL"; fi

# systemd units (installed, enabled; the capture unit is socket/request driven and starts nothing on its own)
install -m 0644 "$(dirname "$0")/vidtoolz-evidence.service" /etc/systemd/system/vidtoolz-evidence.service
install -m 0644 "$(dirname "$0")/vidtoolz-capture.service" /etc/systemd/system/vidtoolz-capture.service
systemctl daemon-reload
systemctl enable vidtoolz-evidence.service vidtoolz-capture.service
echo "deployed: identities, protected store, key, spool, units. Next: point config/screen-capture-policy.json stores at $EVIDENCE_ROOT / $SPOOL (reviewed change), then run the post-deployment verification in README.md."
