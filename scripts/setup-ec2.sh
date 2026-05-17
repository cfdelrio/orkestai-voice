#!/usr/bin/env bash
# =============================================================================
# setup-ec2.sh — Instalación de orkestai-voice en Amazon Linux 2023 / Ubuntu
# =============================================================================
# Uso:
#   chmod +x setup-ec2.sh
#   sudo ./setup-ec2.sh
#
# Qué hace:
#   1. Detecta la distro (Amazon Linux 2023 o Ubuntu)
#   2. Instala Node.js 20, PostgreSQL 15, Nginx, PM2
#   3. Crea la base de datos y el usuario postgres
#   4. Clona el repo y configura el .env
#   5. Corre migraciones Prisma y el seed demo
#   6. Configura PM2 con startup automático
#   7. Configura Nginx como reverse proxy en el puerto 80
# =============================================================================

set -euo pipefail

# ─── Colores ──────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m'

log()    { echo -e "${GREEN}[✔]${NC} $*"; }
info()   { echo -e "${CYAN}[→]${NC} $*"; }
warn()   { echo -e "${YELLOW}[!]${NC} $*"; }
error()  { echo -e "${RED}[✘]${NC} $*"; exit 1; }

# ─── Variables configurables ───────────────────────────────────────────────────
APP_USER="orkestai"
APP_DIR="/opt/orkestai-voice"
REPO_URL="https://github.com/cfdelrio/orkestai-voice.git"
BRANCH="main"
NODE_VERSION="20"
PG_DB="orkestai_voice"
PG_USER="orkestai"
PG_PASS=""          # se genera automáticamente si está vacío
APP_PORT="3000"
DOMAIN=""           # opcional: tu dominio (ej: voice.tudominio.com)

# ─── Detectar distro ──────────────────────────────────────────────────────────
detect_distro() {
  if [ -f /etc/os-release ]; then
    . /etc/os-release
    DISTRO=$ID
  else
    error "No se pudo detectar la distribución."
  fi
  info "Distribución detectada: $DISTRO $VERSION_ID"
}

# ─── Generar password segura ──────────────────────────────────────────────────
generate_password() {
  tr -dc 'A-Za-z0-9!@#$%^&*' < /dev/urandom | head -c 24
}

# ─── Instalar dependencias del sistema ────────────────────────────────────────
install_system_deps() {
  info "Actualizando paquetes del sistema..."

  case "$DISTRO" in
    amzn|al2023)
      # git no depende de curl, se instala limpio
      dnf install -y git
      # nginx puede jalar curl como dep; --allowerasing reemplaza curl-minimal si es necesario
      dnf install -y --allowerasing nginx
      ;;
    ubuntu|debian)
      apt-get update -qq
      apt-get install -y git curl nginx
      ;;
    *)
      error "Distribución no soportada: $DISTRO. Soportadas: Amazon Linux 2023, Ubuntu, Debian."
      ;;
  esac

  log "Dependencias del sistema instaladas."
}

# ─── Instalar Node.js 20 ──────────────────────────────────────────────────────
install_node() {
  if command -v node &>/dev/null; then
    CURRENT_NODE=$(node -v | cut -d. -f1 | tr -d 'v')
    if [ "$CURRENT_NODE" -ge "$NODE_VERSION" ]; then
      log "Node.js $(node -v) ya instalado."
      return
    fi
  fi

  info "Instalando Node.js $NODE_VERSION..."
  curl -fsSL "https://rpm.nodesource.com/setup_${NODE_VERSION}.x" | bash - 2>/dev/null || \
  curl -fsSL "https://deb.nodesource.com/setup_${NODE_VERSION}.x" | bash - 2>/dev/null

  case "$DISTRO" in
    amzn|al2023) dnf install -y nodejs ;;
    ubuntu|debian) apt-get install -y nodejs ;;
  esac

  log "Node.js $(node -v) instalado."
}

# ─── Instalar PostgreSQL 15 ───────────────────────────────────────────────────
install_postgres() {
  if command -v psql &>/dev/null; then
    log "PostgreSQL ya instalado: $(psql --version)"
    return
  fi

  info "Instalando PostgreSQL 15..."

  case "$DISTRO" in
    amzn|al2023)
      dnf install -y postgresql15 postgresql15-server
      postgresql-setup --initdb
      systemctl enable postgresql
      systemctl start postgresql
      ;;
    ubuntu|debian)
      apt-get install -y postgresql postgresql-contrib
      systemctl enable postgresql
      systemctl start postgresql
      ;;
  esac

  log "PostgreSQL instalado."
}

# ─── Instalar PM2 ─────────────────────────────────────────────────────────────
install_pm2() {
  if command -v pm2 &>/dev/null; then
    log "PM2 ya instalado."
    return
  fi
  info "Instalando PM2..."
  npm install -g pm2 --quiet
  log "PM2 instalado."
}

# ─── Crear usuario del sistema ────────────────────────────────────────────────
create_app_user() {
  if id "$APP_USER" &>/dev/null; then
    log "Usuario $APP_USER ya existe."
    return
  fi
  info "Creando usuario del sistema: $APP_USER..."
  useradd -r -m -s /bin/bash "$APP_USER"
  log "Usuario $APP_USER creado."
}

# ─── Configurar base de datos ─────────────────────────────────────────────────
setup_database() {
  if [ -z "$PG_PASS" ]; then
    PG_PASS=$(generate_password)
    warn "Password de PostgreSQL generada automáticamente: $PG_PASS"
    warn "Guardala en un lugar seguro, la necesitarás para el .env"
  fi

  info "Configurando base de datos PostgreSQL..."

  sudo -u postgres psql <<SQL
DO \$\$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '$PG_USER') THEN
    CREATE USER $PG_USER WITH PASSWORD '$PG_PASS';
  END IF;
END
\$\$;

SELECT 'CREATE DATABASE $PG_DB OWNER $PG_USER'
  WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = '$PG_DB')\gexec

GRANT ALL PRIVILEGES ON DATABASE $PG_DB TO $PG_USER;
SQL

  log "Base de datos '$PG_DB' y usuario '$PG_USER' configurados."
}

# ─── Clonar / actualizar repo ─────────────────────────────────────────────────
setup_app() {
  info "Configurando la aplicación en $APP_DIR..."

  if [ -d "$APP_DIR/.git" ]; then
    info "Repo ya existe, haciendo pull..."
    sudo -u "$APP_USER" git -C "$APP_DIR" pull origin "$BRANCH"
  else
    sudo mkdir -p "$APP_DIR"
    sudo chown "$APP_USER":"$APP_USER" "$APP_DIR"
    sudo -u "$APP_USER" git clone --branch "$BRANCH" "$REPO_URL" "$APP_DIR"
  fi

  log "Código actualizado."
}

# ─── Crear .env ───────────────────────────────────────────────────────────────
create_env() {
  local env_file="$APP_DIR/.env"

  if [ -f "$env_file" ]; then
    warn ".env ya existe, no se sobreescribe. Verificá manualmente."
    return
  fi

  # Detectar IP pública del EC2
  PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "localhost")
  WEBHOOK_BASE="http://${DOMAIN:-$PUBLIC_IP}"

  info "Creando .env en $env_file..."

  sudo -u "$APP_USER" tee "$env_file" > /dev/null <<EOF
# ─── Base de datos ────────────────────────────────────────────────────────────
DATABASE_URL="postgresql://${PG_USER}:${PG_PASS}@localhost:5432/${PG_DB}"

# ─── Servidor ─────────────────────────────────────────────────────────────────
PORT=${APP_PORT}
NODE_ENV=production

# ─── Webhook base URL (debe ser accesible públicamente por Infobip) ───────────
WEBHOOK_BASE_URL="${WEBHOOK_BASE}"
EOF

  log ".env creado en $env_file"
  warn "Editá $env_file para completar tus credenciales de Infobip si las tenés."
}

# ─── Instalar dependencias npm y correr migraciones ───────────────────────────
setup_npm() {
  info "Instalando dependencias npm..."
  sudo -u "$APP_USER" npm ci --prefix "$APP_DIR" --quiet

  info "Corriendo migraciones Prisma..."
  sudo -u "$APP_USER" bash -c "cd $APP_DIR && npx prisma migrate deploy"

  info "Corriendo seed demo (ProdeCaballito)..."
  sudo -u "$APP_USER" bash -c "cd $APP_DIR && node prisma/seed.js" || \
    warn "Seed ya aplicado o falló — continuando."

  log "Setup de la app completado."
}

# ─── Configurar PM2 ───────────────────────────────────────────────────────────
setup_pm2() {
  info "Configurando PM2..."

  sudo -u "$APP_USER" pm2 describe orkestai-voice &>/dev/null && \
    sudo -u "$APP_USER" pm2 delete orkestai-voice

  sudo -u "$APP_USER" bash -c "
    cd $APP_DIR && pm2 start server.js \
      --name orkestai-voice \
      --env production \
      --max-memory-restart 300M \
      --log /var/log/orkestai-voice.log \
      --merge-logs
  "

  # Startup automático al reiniciar el servidor
  PM2_STARTUP=$(sudo -u "$APP_USER" pm2 startup systemd -u "$APP_USER" --hp "/home/$APP_USER" 2>&1 | grep "sudo")
  eval "$PM2_STARTUP" 2>/dev/null || true
  sudo -u "$APP_USER" pm2 save

  log "PM2 configurado. La app se reinicia automáticamente."
}

# ─── Configurar Nginx ─────────────────────────────────────────────────────────
setup_nginx() {
  info "Configurando Nginx como reverse proxy..."

  local server_name="${DOMAIN:-_}"

  cat > /etc/nginx/conf.d/orkestai-voice.conf <<NGINX
upstream orkestai_app {
    server 127.0.0.1:${APP_PORT};
    keepalive 64;
}

server {
    listen 80;
    server_name ${server_name};

    # Logs
    access_log /var/log/nginx/orkestai-voice.access.log;
    error_log  /var/log/nginx/orkestai-voice.error.log;

    # Límite de tamaño de body (para uploads de contactos)
    client_max_body_size 10M;

    # Health check directo
    location /health {
        proxy_pass http://orkestai_app;
        access_log off;
    }

    # Webhooks de Infobip (sin buffering para respuesta inmediata)
    location /api/webhooks/ {
        proxy_pass http://orkestai_app;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 30s;
    }

    # API principal
    location / {
        proxy_pass http://orkestai_app;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
        proxy_read_timeout 60s;
    }
}
NGINX

  nginx -t && systemctl enable nginx && systemctl restart nginx
  log "Nginx configurado y reiniciado."
}

# ─── Configurar firewall ──────────────────────────────────────────────────────
setup_firewall() {
  if command -v ufw &>/dev/null; then
    info "Configurando UFW (Ubuntu)..."
    ufw allow 22/tcp   2>/dev/null || true
    ufw allow 80/tcp   2>/dev/null || true
    ufw allow 443/tcp  2>/dev/null || true
    ufw --force enable 2>/dev/null || true
    log "UFW configurado."
  else
    warn "UFW no disponible. Asegurate de abrir los puertos 80 y 443 en el Security Group de EC2."
  fi
}

# ─── Resumen final ────────────────────────────────────────────────────────────
print_summary() {
  PUBLIC_IP=$(curl -sf http://169.254.169.254/latest/meta-data/public-ipv4 2>/dev/null || echo "TU_IP_PUBLICA")

  echo ""
  echo -e "${GREEN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${GREEN}║        orkestai-voice instalado correctamente        ║${NC}"
  echo -e "${GREEN}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""
  echo -e "  ${CYAN}App corriendo en:${NC}    http://${PUBLIC_IP}/health"
  echo -e "  ${CYAN}Webhook Infobip:${NC}     http://${PUBLIC_IP}/api/webhooks/infobip/voice"
  echo -e "  ${CYAN}Logs:${NC}                pm2 logs orkestai-voice"
  echo -e "  ${CYAN}Estado:${NC}              pm2 status"
  echo -e "  ${CYAN}Reiniciar:${NC}           pm2 restart orkestai-voice"
  echo ""
  echo -e "  ${YELLOW}Próximos pasos:${NC}"
  echo -e "    1. Editá ${APP_DIR}/.env con tus credenciales de Infobip"
  echo -e "    2. Configurá WEBHOOK_BASE_URL con tu dominio o IP pública"
  echo -e "    3. pm2 restart orkestai-voice"
  if [ -n "$DOMAIN" ]; then
    echo -e "    4. Instalá SSL: certbot --nginx -d ${DOMAIN}"
  else
    echo -e "    4. Apuntá un dominio a esta IP y corré: certbot --nginx -d TU_DOMINIO"
  fi
  echo ""
  echo -e "  ${CYAN}DB:${NC} postgresql://${PG_USER}:****@localhost:5432/${PG_DB}"
  echo ""
}

# ─── Main ─────────────────────────────────────────────────────────────────────
main() {
  echo ""
  echo -e "${CYAN}╔══════════════════════════════════════════════════════╗${NC}"
  echo -e "${CYAN}║         orkestai-voice — Setup EC2                   ║${NC}"
  echo -e "${CYAN}╚══════════════════════════════════════════════════════╝${NC}"
  echo ""

  [ "$EUID" -ne 0 ] && error "Ejecutá este script como root: sudo ./setup-ec2.sh"

  detect_distro
  install_system_deps
  install_node
  install_postgres
  install_pm2
  create_app_user
  setup_database
  setup_app
  create_env
  setup_npm
  setup_pm2
  setup_nginx
  setup_firewall
  print_summary
}

main "$@"
