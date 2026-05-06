#!/bin/bash
# Spreader Pi — one-shot setup script
# Run once after first boot on Raspberry Pi OS (64-bit, Desktop variant)
#   sudo bash pi-setup.sh
#
# Assumes:
#   - hostname already set to "spreader-pi" via Pi Imager
#   - SSH enabled via Pi Imager
#   - WiFi configured via Pi Imager (for initial setup; not needed in the field)
#   - User is "pi"

set -euo pipefail

REPO_URL="https://github.com/taborbachelor/spreader-project.git"
REPO_DIR="/home/pi/spreader-project"
SERVICE_DIR="/etc/systemd/system"
PI_USER="pi"

echo "=== Spreader Pi Setup ==="

# ── System packages ──────────────────────────────────────────────────────────
echo "[1/6] Installing system packages..."
apt-get update -y
apt-get upgrade -y
apt-get install -y \
    python3-pip \
    python3-venv \
    git \
    chromium-browser \
    unclutter \
    xdotool

# ── Python environment ────────────────────────────────────────────────────────
echo "[2/6] Setting up Python venv..."
sudo -u "$PI_USER" python3 -m venv "$REPO_DIR/.venv" 2>/dev/null || true

if [ ! -d "$REPO_DIR" ]; then
    echo "[3/6] Cloning repo..."
    sudo -u "$PI_USER" git clone "$REPO_URL" "$REPO_DIR"
else
    echo "[3/6] Repo exists — pulling latest..."
    sudo -u "$PI_USER" git -C "$REPO_DIR" pull
fi

echo "[4/6] Installing Python dependencies..."
sudo -u "$PI_USER" "$REPO_DIR/.venv/bin/pip" install --upgrade pip
sudo -u "$PI_USER" "$REPO_DIR/.venv/bin/pip" install hx711 pyserial RPi.GPIO websockets

# ── Disable screen blanking ───────────────────────────────────────────────────
echo "[5/6] Disabling screen blanking..."
LIGHTDM_CONF="/etc/lightdm/lightdm.conf"
if grep -q "^\[Seat:\*\]" "$LIGHTDM_CONF" 2>/dev/null; then
    # Already has seat section — add xserver-command if not present
    if ! grep -q "xserver-command" "$LIGHTDM_CONF"; then
        sed -i '/^\[Seat:\*\]/a xserver-command=X -s 0 dpms' "$LIGHTDM_CONF"
    fi
fi

# ── systemd services ──────────────────────────────────────────────────────────
echo "[6/6] Installing systemd services..."

cp "$REPO_DIR/firmware/spreader-bridge.service" "$SERVICE_DIR/spreader-bridge.service"
cp "$REPO_DIR/firmware/spreader-kiosk.service"  "$SERVICE_DIR/spreader-kiosk.service"

systemctl daemon-reload
systemctl enable spreader-bridge.service
systemctl enable spreader-kiosk.service

echo ""
echo "=== Setup complete. Reboot to launch kiosk. ==="
echo "    sudo reboot"
echo ""
echo "Useful commands:"
echo "  sudo systemctl status spreader-bridge   — check bridge status"
echo "  sudo journalctl -fu spreader-bridge     — live bridge log"
echo "  sudo systemctl restart spreader-kiosk   — reload UI"
