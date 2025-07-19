#!/bin/bash

# HomeLab Dashboard Startup Script

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
VENV_DIR="$SCRIPT_DIR/venv"
APP_DIR="$SCRIPT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

echo -e "${BLUE}🏠 HomeLab Dashboard Startup${NC}"
echo "=================================="

# Check if we're in the right directory
if [ ! -f "$APP_DIR/app.py" ]; then
    echo -e "${RED}❌ app.py nicht gefunden in $APP_DIR${NC}"
    echo "Bitte das Skript aus dem Webroot-Verzeichnis ausführen"
    exit 1
fi

# Create virtual environment if it doesn't exist
if [ ! -d "$VENV_DIR" ]; then
    echo -e "${YELLOW}📦 Erstelle Virtual Environment...${NC}"
    python3 -m venv "$VENV_DIR"
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Fehler beim Erstellen des Virtual Environment${NC}"
        exit 1
    fi
fi

# Activate virtual environment
echo -e "${BLUE}🔧 Aktiviere Virtual Environment...${NC}"
source "$VENV_DIR/bin/activate"

# Check if requirements.txt exists and install dependencies
if [ -f "$APP_DIR/requirements.txt" ]; then
    echo -e "${BLUE}📋 Installiere Dependencies...${NC}"
    pip install -r "$APP_DIR/requirements.txt"
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Fehler beim Installieren der Dependencies${NC}"
        exit 1
    fi
else
    echo -e "${YELLOW}⚠️ requirements.txt nicht gefunden, installiere Basis-Pakete...${NC}"
    pip install fastapi uvicorn paramiko websockets python-multipart
fi

# Create config directory if it doesn't exist
if [ ! -d "$APP_DIR/config" ]; then
    echo -e "${YELLOW}📁 Erstelle config-Verzeichnis...${NC}"
    mkdir -p "$APP_DIR/config"
fi

# Check if config files exist
config_files=(
    "config/servers.json"
    "config/categories.json" 
    "config/services.json"
)

missing_configs=()
for file in "${config_files[@]}"; do
    if [ ! -f "$APP_DIR/$file" ]; then
        missing_configs+=("$file")
    fi
done

if [ ${#missing_configs[@]} -gt 0 ]; then
    echo -e "${YELLOW}⚠️ Fehlende Konfigurationsdateien:${NC}"
    for file in "${missing_configs[@]}"; do
        echo "   - $file"
    done
    echo "Das Dashboard wird mit Fallback-Konfiguration starten."
    echo "Erstelle die fehlenden JSON-Dateien für vollständige Funktionalität."
fi

# Create static directories if they don't exist
mkdir -p "$APP_DIR/static/css"
mkdir -p "$APP_DIR/static/js"

# Check if all required files exist
required_files=(
    "static/index.html"
    "static/css/style.css"
    "static/js/main.js"
    "static/js/terminal.js"
    "static/js/utils.js"
)

missing_files=()
for file in "${required_files[@]}"; do
    if [ ! -f "$APP_DIR/$file" ]; then
        missing_files+=("$file")
    fi
done

if [ ${#missing_files[@]} -gt 0 ]; then
    echo -e "${RED}❌ Fehlende Dateien:${NC}"
    for file in "${missing_files[@]}"; do
        echo "   - $file"
    done
    echo -e "${YELLOW}Bitte erstelle diese Dateien aus den Artifacts.${NC}"
    exit 1
fi

# Check if port 8000 is already in use
if netstat -tln | grep -q ":8000 "; then
    echo -e "${YELLOW}⚠️ Port 8000 ist bereits belegt${NC}"
    echo "Möglicherweise läuft das Dashboard bereits."
    echo "Stoppe bestehende Prozesse auf Port 8000:"
    
    # Try to find and kill existing processes
    PIDS=$(lsof -t -i:8000 2>/dev/null)
    if [ -n "$PIDS" ]; then
        echo "Stoppe Prozesse: $PIDS"
        kill $PIDS
        sleep 2
    fi
fi

# Start the application
echo -e "${GREEN}🚀 Starte HomeLab Dashboard...${NC}"
echo "=================================="
echo -e "${BLUE}Frontend:${NC} http://localhost:8000/"
echo -e "${BLUE}API:${NC}      http://localhost:8000/api/servers"
echo -e "${BLUE}Health:${NC}   http://localhost:8000/health"
echo "=================================="
echo -e "${YELLOW}Drücke Ctrl+C zum Beenden${NC}"
echo ""

# Change to app directory and start
cd "$APP_DIR"
python3 app.py