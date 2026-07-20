#!/usr/bin/env bash
set -euo pipefail

: "${deployUsername:?deployUsername is required}"

if ! getent passwd "$deployUsername" >/dev/null; then
  echo "Deploy user does not exist: $deployUsername" >&2
  exit 1
fi

if ! command -v ufw >/dev/null 2>&1; then
  apt-get update -qq
  apt-get install -y -qq ufw >/dev/null
fi

install -d -o root -g root -m 0755 /etc/ssh/sshd_config.d
sshd_drop_in=$(mktemp /etc/ssh/sshd_config.d/.99-tomoribot-lockdown.XXXXXX)
cleanup() {
  rm -f "$sshd_drop_in"
}
trap cleanup EXIT
cat >"$sshd_drop_in" <<'EOF'
PermitRootLogin no
PasswordAuthentication no
KbdInteractiveAuthentication no
ChallengeResponseAuthentication no
EOF
chmod 0644 "$sshd_drop_in"
chown root:root "$sshd_drop_in"
mv -f "$sshd_drop_in" /etc/ssh/sshd_config.d/99-tomoribot-lockdown.conf

# Ubuntu's sshd syntax check requires its ephemeral privilege-separation
# directory even when the service has not started since the latest boot.
install -d -o root -g root -m 0755 /run/sshd
/usr/sbin/sshd -t
gpasswd -d "$deployUsername" docker >/dev/null 2>&1 || true
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw --force enable >/dev/null
systemctl disable --now ssh >/dev/null 2>&1 || \
  systemctl disable --now sshd >/dev/null 2>&1 || true

if id -nG "$deployUsername" | tr ' ' '\n' | grep -qx docker; then
  echo "Deploy user remains a member of the docker group." >&2
  exit 1
fi
if systemctl is-active --quiet ssh || systemctl is-active --quiet sshd; then
  echo "SSH service remains active." >&2
  exit 1
fi
if ! ufw status | grep -q '^Status: active$'; then
  echo "UFW is not active." >&2
  exit 1
fi

echo "TomoriBot host lockdown completed."
echo "TOMORIBOT_HOST_LOCKDOWN_SUCCEEDED"
