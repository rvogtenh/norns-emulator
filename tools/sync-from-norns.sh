#!/bin/bash
# sync-from-norns.sh — pull dust/data and dust/audio from Norns → emulator
#
# Usage:  ./tools/sync-from-norns.sh [norns-ip]
#   default IP: 192.168.1.86

NORNS_IP="${1:-192.168.1.86}"
NORNS_USER="we"
NORNS_PASS="cloud912"
SCRIPT_DIR="$(cd "$(dirname "$0")/.." && pwd)"

DATA_DIR="$SCRIPT_DIR/data"
AUDIO_DIR="$SCRIPT_DIR/audio"

echo "Syncing from Norns ($NORNS_IP)…"

# dust/data → ./data/
echo "  data:  dust/data/ → $DATA_DIR/"
SSH_OPTS="-o StrictHostKeyChecking=no -o UserKnownHostsFile=/dev/null"

sshpass -p "$NORNS_PASS" rsync -avz --delete \
  -e "ssh $SSH_OPTS" \
  "${NORNS_USER}@${NORNS_IP}:dust/data/" \
  "$DATA_DIR/" \
  --exclude="*.log"

# dust/audio → ./audio/
echo "  audio: dust/audio/ → $AUDIO_DIR/"
sshpass -p "$NORNS_PASS" rsync -avz \
  -e "ssh $SSH_OPTS" \
  "${NORNS_USER}@${NORNS_IP}:dust/audio/" \
  "$AUDIO_DIR/" \
  --exclude="*.aif" --exclude="*.aiff"

echo "Done. Restart script in emulator to pick up new data."
