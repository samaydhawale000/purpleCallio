#!/bin/bash
# PurpleCallio VPS Setup Script
# Run once on a fresh Ubuntu 22.04 / Debian 12 VPS.
# Usage: bash setup.sh yourdomain.com your@email.com

set -e

DOMAIN=$1
EMAIL=$2

if [ -z "$DOMAIN" ] || [ -z "$EMAIL" ]; then
  echo "Usage: bash setup.sh <domain> <email>"
  echo "Example: bash setup.sh purplecallio.com admin@purplecallio.com"
  exit 1
fi

echo "==> Installing Docker..."
curl -fsSL https://get.docker.com | sh
usermod -aG docker $USER

echo "==> Installing Certbot..."
apt-get install -y certbot

# One host serves the web app, /api/, /socket.io/ and TURN (see DEPLOYMENT.md).
# Nginx and Coturn both read /etc/letsencrypt/live/$DOMAIN/.
echo "==> Getting the TLS certificate for $DOMAIN..."
certbot certonly --standalone \
  -d $DOMAIN \
  --non-interactive --agree-tos -m $EMAIL

# Nginx, the web build and TURN all derive from PUBLIC_HOST in .env.
if [ ! -f .env ]; then
  echo "==> Creating .env for $DOMAIN..."
  sed "s/^PUBLIC_HOST=.*/PUBLIC_HOST=$DOMAIN/" .env.example > .env
  chmod 600 .env
fi

echo "==> Opening firewall ports..."
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 5349/udp
ufw allow 5349/tcp
ufw allow 49152:65535/udp
ufw --force enable

echo ""
echo "==> Done. Next steps:"
echo "   1. Fill in the <placeholder> values in .env (PUBLIC_HOST=$DOMAIN is set)"
echo "   2. node scripts/check-env.mjs .env"
echo "   3. docker compose up -d --build"
echo ""
