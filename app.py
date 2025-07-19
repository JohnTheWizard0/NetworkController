#!/usr/bin/env python3
"""
HomeLab Dashboard SSH Backend
FastAPI + WebSocket + Simple subprocess SSH
"""

import asyncio
import json
import subprocess
import threading
import time
import os
import pty
import select
import signal
from pathlib import Path
from typing import Dict, Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
import uvicorn


class SSHConnection:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.ssh_process: Optional[subprocess.Popen] = None
        self.master_fd: Optional[int] = None
        self.slave_fd: Optional[int] = None
        self.connected = False
        self.output_thread: Optional[threading.Thread] = None
        self.loop = None

    async def connect(self, host: str, port: int = 22, username: str = None):
        """SSH-Verbindung mit echtem PTY"""
        try:
            print(f"🔌 SSH-Verbindung mit PTY zu {username}@{host}:{port}")
            
            # Store event loop for thread communication
            self.loop = asyncio.get_event_loop()
            
            # Create a real PTY
            self.master_fd, self.slave_fd = pty.openpty()
            
            # SSH-Befehl
            if username:
                ssh_target = f"{username}@{host}"
            else:
                ssh_target = host
                
            ssh_cmd = [
                'ssh',
                ssh_target,
                '-p', str(port),
                '-o', 'StrictHostKeyChecking=no',
                '-o', 'UserKnownHostsFile=/dev/null',
                '-o', 'LogLevel=INFO',
                '-o', 'PubkeyAuthentication=no',
                '-o', 'PasswordAuthentication=yes',
                '-o', 'KbdInteractiveAuthentication=yes',
                '-o', 'PreferredAuthentications=keyboard-interactive,password',
                '-o', 'NumberOfPasswordPrompts=3',
                '-o', 'ConnectTimeout=10'
            ]
            
            print(f"🔧 SSH-Befehl mit PTY: {' '.join(ssh_cmd)}")
            
            # Starte SSH-Prozess mit PTY
            self.ssh_process = subprocess.Popen(
                ssh_cmd,
                stdin=self.slave_fd,
                stdout=self.slave_fd,
                stderr=self.slave_fd,
                preexec_fn=os.setsid
            )
            
            # Close slave fd in parent (SSH process keeps it open)
            os.close(self.slave_fd)
            self.slave_fd = None
            
            self.connected = True
            
            await self.websocket.send_text(json.dumps({
                'type': 'connected',
                'message': f'SSH PTY started for {ssh_target}'
            }))
            
            # Output-Thread starten
            self.output_thread = threading.Thread(target=self._read_ssh_output, daemon=True)
            self.output_thread.start()
            
            print(f"✅ SSH-PTY gestartet für {ssh_target}")
            
        except Exception as e:
            error_msg = f"SSH-Verbindung fehlgeschlagen: {str(e)}"
            print(f"❌ {error_msg}")
            await self.websocket.send_text(json.dumps({
                'type': 'error',
                'message': f'Connection failed: {str(e)}'
            }))

    def _read_ssh_output(self):
        """SSH-Output vom PTY lesen"""
        try:
            print(f"🔄 PTY Output-Thread gestartet")
            
            while self.connected and self.master_fd is not None:
                try:
                    # Check if process is still alive
                    if self.ssh_process and self.ssh_process.poll() is not None:
                        print(f"🔌 SSH-Prozess beendet mit Code: {self.ssh_process.returncode}")
                        break
                    
                    # Use select to check for available data
                    ready, _, _ = select.select([self.master_fd], [], [], 0.1)
                    
                    if ready:
                        try:
                            # Read from PTY
                            data = os.read(self.master_fd, 1024)
                            if data:
                                # Decode and send
                                text = data.decode('utf-8', errors='replace')
                                print(f"📥 SSH PTY Output: {repr(text[:100])}")
                                
                                if self.loop:
                                    asyncio.run_coroutine_threadsafe(
                                        self.websocket.send_text(json.dumps({
                                            'type': 'output',
                                            'data': text
                                        })),
                                        self.loop
                                    )
                            else:
                                time.sleep(0.01)
                                
                        except OSError as e:
                            if e.errno == 5:
                                print("🔌 PTY geschlossen")
                                break
                            else:
                                print(f"❌ PTY Read-Fehler: {e}")
                                time.sleep(0.1)
                    else:
                        time.sleep(0.01)
                        
                except Exception as read_error:
                    print(f"❌ PTY Read-Fehler: {read_error}")
                    time.sleep(0.1)
                    
        except Exception as e:
            print(f"❌ SSH PTY Output-Thread Fehler: {e}")
        finally:
            print(f"🔄 PTY Output-Thread beendet")
            if self.loop:
                asyncio.run_coroutine_threadsafe(
                    self.websocket.send_text(json.dumps({
                        'type': 'disconnected',
                        'message': 'SSH PTY session ended'
                    })),
                    self.loop
                )

    async def send_input(self, data: str):
        """Input an SSH-PTY senden"""
        if self.connected and self.master_fd is not None:
            try:
                print(f"📤 SSH PTY Input: {repr(data)}")
                os.write(self.master_fd, data.encode('utf-8'))
            except Exception as e:
                print(f"❌ SSH PTY Input-Fehler: {e}")
                await self.websocket.send_text(json.dumps({
                    'type': 'error',
                    'message': f'Failed to send input: {str(e)}'
                }))

    def disconnect(self):
        """SSH-PTY-Verbindung schließen"""
        print(f"🔌 SSH-PTY-Verbindung schließen")
        self.connected = False
        
        if self.master_fd is not None:
            try:
                os.close(self.master_fd)
            except:
                pass
            self.master_fd = None
        
        if self.slave_fd is not None:
            try:
                os.close(self.slave_fd)
            except:
                pass
            self.slave_fd = None
        
        if self.ssh_process:
            try:
                os.killpg(os.getpgid(self.ssh_process.pid), signal.SIGTERM)
                try:
                    self.ssh_process.wait(timeout=3)
                except subprocess.TimeoutExpired:
                    print("🔫 SSH-Prozess forciert beenden")
                    os.killpg(os.getpgid(self.ssh_process.pid), signal.SIGKILL)
                    self.ssh_process.wait()
            except Exception as e:
                print(f"❌ Fehler beim Schließen: {e}")
            self.ssh_process = None


class PingChecker:
    def __init__(self):
        self.ping_results = {}
        self.ping_thread = None
        self.running = False
        
    def start_ping_monitoring(self, servers):
        """Startet kontinuierliches Ping-Monitoring"""
        if self.running:
            return
            
        self.running = True
        self.ping_thread = threading.Thread(target=self._ping_loop, args=(servers,), daemon=True)
        self.ping_thread.start()
        print("✅ Ping-Monitoring gestartet")
    
    def _ping_loop(self, servers):
        """Kontinuierliche Ping-Überwachung"""
        while self.running:
            for server in servers:
                host = server.get('host')
                hostname = server.get('hostname')
                if host and hostname:
                    self.ping_results[hostname] = self._ping_host(host)
            time.sleep(30)
    
    def _ping_host(self, host):
        """Einzelnen Host pingen"""
        try:
            result = subprocess.run(
                ['ping', '-c', '1', '-W', '2', host],
                capture_output=True,
                text=True,
                timeout=5
            )
            
            success = result.returncode == 0
            print(f"🏓 Ping {host}: {'✅' if success else '❌'}")
            return 'online' if success else 'offline'
            
        except Exception as e:
            print(f"❌ Ping-Fehler für {host}: {e}")
            return 'offline'
    
    def get_status(self, server_id):
        """Status für einen Server abrufen"""
        return self.ping_results.get(server_id, 'unknown')
    
    def stop(self):
        """Ping-Monitoring stoppen"""
        self.running = False


# FastAPI App
app = FastAPI(title="HomeLab Dashboard")

# Static Files
app.mount("/static", StaticFiles(directory="static"), name="static")

# In-Memory Connection Store
connections: Dict[str, SSHConnection] = {}

# Configuration Cache
config_cache = {
    'servers': None,
    'categories': None,
    'services': None
}

config_paths = {
    'servers': Path("config/servers.json"),
    'categories': Path("config/categories.json"),
    'services': Path("config/services.json")
}

# Ping Checker
ping_checker = PingChecker()


def load_config_file(config_type: str):
    """Lade eine einzelne Konfigurationsdatei"""
    try:
        config_path = config_paths[config_type]
        if config_path.exists():
            with open(config_path, 'r', encoding='utf-8') as f:
                data = json.load(f)
                print(f"✅ {config_type}.json geladen")
                return data
        else:
            print(f"⚠️ {config_path} nicht gefunden")
            return get_fallback_config(config_type)
            
    except Exception as e:
        print(f"❌ Fehler beim Laden von {config_type}.json: {e}")
        return get_fallback_config(config_type)


def get_fallback_config(config_type: str):
    """Fallback-Konfigurationen"""
    fallbacks = {
        'categories': {
            "categories": [
                {"id": "intern", "name": "Intern", "subnet": "192.168.1.0/24", "color": "#2ecc71"}
            ]
        },
        'services': {
            "services": []
        },
        'servers': {
            "servers": [
                {
                    "hostname": "Konfiguration fehlt",
                    "description": f"config/{config_type}.json erstellen",
                    "category_id": "intern",
                    "host": "127.0.0.1",
                    "shared": false,
                    "access": {"ssh": false},
                    "notes": f"Erstelle config/{config_type}.json",
                    "status": "offline"
                }
            ]
        }
    }
    return fallbacks.get(config_type, {})


def load_all_configs():
    """Lade alle Konfigurationsdateien"""
    for config_type in config_cache.keys():
        config_cache[config_type] = load_config_file(config_type)
    
    # Ping-Monitoring für Server starten
    if config_cache['servers']:
        servers = config_cache['servers'].get('servers', [])
        ping_checker.start_ping_monitoring(servers)


def enrich_data():
    """Verknüpfe Services mit Hosts und Kategorien"""
    if not all(config_cache.values()):
        return None
    
    # Kategorien als Dict für schnellen Lookup
    categories_dict = {cat['id']: cat for cat in config_cache['categories']['categories']}
    
    # Services gruppiert nach hostname
    services_by_hostname = {}
    for service in config_cache['services']['services']:
        hostname = service['hostname']
        if hostname not in services_by_hostname:
            services_by_hostname[hostname] = []
        services_by_hostname[hostname].append(service)
    
    # Server anreichern
    enriched_servers = []
    for server in config_cache['servers']['servers']:
        # Ping-Status hinzufügen (hostname als ID verwenden)
        server['status'] = ping_checker.get_status(server['hostname'])
        
        # Kategorie-Informationen hinzufügen
        category = categories_dict.get(server['category_id'], {})
        server['category'] = category
        
        # Services hinzufügen
        server['services'] = services_by_hostname.get(server['hostname'], [])
        
        enriched_servers.append(server)
    
    return {
        'servers': enriched_servers,
        'categories': config_cache['categories']['categories'],
        'services': config_cache['services']['services']
    }


@app.get("/")
async def root():
    """Redirect to static frontend"""
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "HomeLab Dashboard is running"}


@app.get("/api/dashboard")
async def get_dashboard_data():
    """Vollständige Dashboard-Daten mit verknüpften Services"""
    load_all_configs()
    enriched_data = enrich_data()
    
    if not enriched_data:
        raise HTTPException(status_code=500, detail="Configuration could not be loaded")
    
    return enriched_data


@app.get("/api/servers")
async def get_servers():
    """Server-Konfiguration (Legacy-Endpoint für Kompatibilität)"""
    dashboard_data = await get_dashboard_data()
    return {
        'networks': dashboard_data['categories'],  # Backward compatibility
        'servers': dashboard_data['servers']
    }


@app.get("/api/categories")
async def get_categories():
    """Kategorien-Konfiguration"""
    config_cache['categories'] = load_config_file('categories')
    return config_cache['categories']


@app.get("/api/services")
async def get_services():
    """Services-Konfiguration"""
    config_cache['services'] = load_config_file('services')
    return config_cache['services']


@app.websocket("/ws/ssh")
async def ssh_websocket(websocket: WebSocket):
    """SSH WebSocket Handler"""
    await websocket.accept()
    connection_id = id(websocket)
    ssh_conn = SSHConnection(websocket)
    connections[connection_id] = ssh_conn
    
    print(f"🔗 WebSocket-Verbindung hergestellt: {connection_id}")
    
    try:
        while True:
            data = await websocket.receive_text()
            message = json.loads(data)
            
            action = message.get('action')
            print(f"📨 WebSocket Action: {action}")
            
            if action == 'connect':
                host = message.get('host')
                port = message.get('port', 22)
                username = message.get('username')
                
                print(f"📡 SSH-Verbindung starten für: {username}@{host}:{port}")
                
                if not host:
                    await websocket.send_text(json.dumps({
                        'type': 'error',
                        'message': 'Host is required'
                    }))
                    continue
                
                await ssh_conn.connect(host, port, username)
                
            elif action == 'input':
                input_data = message.get('data')
                await ssh_conn.send_input(input_data)
                
            elif action == 'disconnect':
                ssh_conn.disconnect()
                break
                
    except WebSocketDisconnect:
        print(f"🔌 WebSocket getrennt: {connection_id}")
    except Exception as e:
        print(f"❌ SSH WebSocket Fehler: {e}")
    finally:
        ssh_conn.disconnect()
        if connection_id in connections:
            del connections[connection_id]
        print(f"🧹 Verbindung bereinigt: {connection_id}")


if __name__ == "__main__":
    print("🏠 HomeLab Dashboard SSH Backend")
    print("=" * 50)
    print(f"Frontend: http://localhost:8000/")
    print(f"Health: http://localhost:8000/health")
    print(f"API Dashboard: http://localhost:8000/api/dashboard")
    print(f"API Legacy: http://localhost:8000/api/servers")
    print(f"WebSocket: ws://localhost:8000/ws/ssh")
    print("=" * 50)
    
    # Config beim Start laden
    load_all_configs()
    
    try:
        uvicorn.run(
            app,
            host="0.0.0.0",
            port=8000,
            log_level="info"
        )
    finally:
        ping_checker.stop()
        print("🧹 Backend sauber beendet")