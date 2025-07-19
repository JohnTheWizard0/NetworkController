#!/usr/bin/env python3
"""
HomeLab Dashboard SSH Backend
FastAPI + WebSocket + Paramiko SSH Terminal + Ping Status
"""

import asyncio
import json
import subprocess
import threading
import time
from pathlib import Path
from typing import Dict, Optional

import paramiko
from fastapi import FastAPI, WebSocket, WebSocketDisconnect, HTTPException
from fastapi.staticfiles import StaticFiles
from fastapi.responses import RedirectResponse
import uvicorn


class SSHConnection:
    def __init__(self, websocket: WebSocket):
        self.websocket = websocket
        self.ssh_client: Optional[paramiko.SSHClient] = None
        self.ssh_channel: Optional[paramiko.Channel] = None
        self.connected = False
        self.output_thread: Optional[threading.Thread] = None

    async def connect_direct(self, host: str, port: int = 22):
        """Direkte SSH-Verbindung - lässt SSH selbst nach Anmeldedaten fragen"""
        try:
            self.ssh_client = paramiko.SSHClient()
            self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            print(f"🔌 Direkte SSH-Verbindung zu {host}:{port}")
            
            # Verbindung ohne Authentifizierung versuchen
            # Das wird fehlschlagen, aber SSH zeigt Login-Prompt
            try:
                # Erweiterte SSH-Verbindung mit interaktiver Authentifizierung
                transport = paramiko.Transport((host, port))
                transport.start_client()
                
                # Interactive Shell direkt öffnen
                self.ssh_channel = transport.open_session()
                self.ssh_channel.get_pty(term='xterm-256color', width=120, height=30)
                self.ssh_channel.invoke_shell()
                
                self.connected = True
                
                await self.websocket.send_text(json.dumps({
                    'type': 'connected',
                    'message': f'Connected to {host}'
                }))
                
                # Output-Thread starten
                self.output_thread = threading.Thread(target=self._read_ssh_output, daemon=True)
                self.output_thread.start()
                
                print(f"✅ SSH-Terminal geöffnet für {host}")
                
            except Exception as e:
                # Fallback: Standard SSH mit Login-Prompt
                await self._start_ssh_subprocess(host, port)
                
        except Exception as e:
            error_msg = f"SSH-Verbindung fehlgeschlagen: {str(e)}"
            print(f"❌ {error_msg}")
            await self.websocket.send_text(json.dumps({
                'type': 'error',
                'message': f'Connection failed: {str(e)}'
            }))

    async def _start_ssh_subprocess(self, host: str, port: int):
        """SSH als Subprocess starten für echtes Terminal-Verhalten"""
        try:
            # SSH-Subprocess starten
            process = subprocess.Popen(
                ['ssh', f'{host}', '-p', str(port), '-o', 'StrictHostKeyChecking=no'],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                universal_newlines=False,
                bufsize=0
            )
            
            self.ssh_process = process
            self.connected = True
            
            await self.websocket.send_text(json.dumps({
                'type': 'connected',
                'message': f'SSH process started for {host}'
            }))
            
            # Output-Thread für Subprocess
            self.output_thread = threading.Thread(target=self._read_subprocess_output, daemon=True)
            self.output_thread.start()
            
            print(f"✅ SSH-Subprocess gestartet für {host}")
            
        except Exception as e:
            print(f"❌ SSH-Subprocess Fehler: {e}")
            await self.websocket.send_text(json.dumps({
                'type': 'error',
                'message': f'SSH subprocess failed: {str(e)}'
            }))

    def _read_subprocess_output(self):
        """SSH-Subprocess Output lesen"""
        try:
            while self.connected and hasattr(self, 'ssh_process'):
                if self.ssh_process.poll() is None:  # Process noch aktiv
                    data = self.ssh_process.stdout.read(1024)
                    if data:
                        try:
                            text = data.decode('utf-8', errors='ignore')
                            asyncio.run_coroutine_threadsafe(
                                self.websocket.send_text(json.dumps({
                                    'type': 'output',
                                    'data': text
                                })),
                                asyncio.get_event_loop()
                            )
                        except:
                            pass
                else:
                    # Prozess beendet
                    break
                    
                time.sleep(0.01)
                    
        except Exception as e:
            print(f"❌ SSH Subprocess Output-Thread Fehler: {e}")

    def _read_ssh_output(self):
        """SSH-Output lesen und an WebSocket weiterleiten"""
        try:
            while self.connected and self.ssh_channel:
                if self.ssh_channel.recv_ready():
                    data = self.ssh_channel.recv(1024).decode('utf-8', errors='ignore')
                    if data:
                        asyncio.run_coroutine_threadsafe(
                            self.websocket.send_text(json.dumps({
                                'type': 'output',
                                'data': data
                            })),
                            asyncio.get_event_loop()
                        )
                else:
                    time.sleep(0.01)
                    
        except Exception as e:
            print(f"❌ SSH Output-Thread Fehler: {e}")

    async def send_input(self, data: str):
        """Input an SSH senden"""
        try:
            if hasattr(self, 'ssh_process') and self.ssh_process.poll() is None:
                # Subprocess Input
                self.ssh_process.stdin.write(data.encode('utf-8'))
                self.ssh_process.stdin.flush()
            elif self.connected and self.ssh_channel:
                # Paramiko Channel Input
                self.ssh_channel.send(data)
        except Exception as e:
            print(f"❌ SSH Input-Fehler: {e}")

    def disconnect(self):
        """SSH-Verbindung schließen"""
        print(f"🔌 SSH-Verbindung schließen")
        self.connected = False
        
        # Subprocess beenden
        if hasattr(self, 'ssh_process'):
            try:
                self.ssh_process.terminate()
            except:
                pass
        
        # Paramiko schließen
        if self.ssh_channel:
            try:
                self.ssh_channel.close()
            except:
                pass
        
        if self.ssh_client:
            try:
                self.ssh_client.close()
            except:
                pass


async def ping_host(host: str) -> bool:
    """Ping einen Host um Status zu prüfen"""
    try:
        # Ping-Kommando (funktioniert auf Linux/macOS/Windows)
        process = await asyncio.create_subprocess_exec(
            'ping', '-c', '1', '-W', '2', host,
            stdout=asyncio.subprocess.DEVNULL,
            stderr=asyncio.subprocess.DEVNULL
        )
        await process.wait()
        return process.returncode == 0
    except:
        return False


# FastAPI App
app = FastAPI(title="HomeLab Dashboard")

# Static Files
app.mount("/static", StaticFiles(directory="static"), name="static")

# In-Memory Connection Store
connections: Dict[str, SSHConnection] = {}

# Server Configuration Cache
server_config_cache = None
config_file_path = Path("config/servers.json")


def load_server_config():
    """Server-Konfiguration aus JSON-Datei laden"""
    global server_config_cache
    
    try:
        if config_file_path.exists():
            with open(config_file_path, 'r', encoding='utf-8') as f:
                server_config_cache = json.load(f)
                print(f"✅ Server-Konfiguration geladen: {len(server_config_cache.get('servers', []))} Server")
        else:
            print(f"⚠️ Konfigurationsdatei nicht gefunden: {config_file_path}")
            # Fallback-Konfiguration
            server_config_cache = {
                "networks": [
                    {"name": "Intern", "subnet": "192.168.1.0/24", "color": "#2ecc71"}
                ],
                "servers": [
                    {
                        "id": "config-missing",
                        "name": "Konfiguration fehlt",
                        "services": "config/servers.json erstellen",
                        "network": "Intern",
                        "host": "127.0.0.1",
                        "dns": ["localhost"],
                        "shared": false,
                        "access": {"ssh": false},
                        "ports": [],
                        "notes": f"Erstelle {config_file_path} mit Server-Konfiguration",
                        "status": "offline"
                    }
                ]
            }
            
    except Exception as e:
        print(f"❌ Fehler beim Laden der Server-Konfiguration: {e}")
        server_config_cache = {"networks": [], "servers": []}
    
    return server_config_cache


@app.get("/")
async def root():
    """Redirect to static frontend"""
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "HomeLab Dashboard is running"}


@app.get("/api/servers")
async def get_servers():
    """Server-Konfiguration über API bereitstellen"""
    config = load_server_config()
    if not config:
        raise HTTPException(status_code=500, detail="Server configuration could not be loaded")
    
    # Status für alle Server per Ping prüfen
    for server in config['servers']:
        is_online = await ping_host(server['host'])
        server['status'] = 'online' if is_online else 'offline'
    
    return config


@app.get("/api/ping/{server_id}")
async def ping_server(server_id: str):
    """Einzelnen Server anpingen"""
    config = load_server_config()
    server = next((s for s in config['servers'] if s['id'] == server_id), None)
    
    if not server:
        raise HTTPException(status_code=404, detail="Server not found")
    
    is_online = await ping_host(server['host'])
    return {
        "server_id": server_id,
        "host": server['host'],
        "status": "online" if is_online else "offline",
        "timestamp": time.time()
    }


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
            
            if action == 'connect':
                # Direkte SSH-Verbindung (ohne vorherige Authentifizierung)
                host = message.get('host')
                port = message.get('port', 22)
                
                print(f"📡 Direkte SSH-Verbindung: {host}:{port}")
                
                if not host:
                    await websocket.send_text(json.dumps({
                        'type': 'error',
                        'message': 'Host is required'
                    }))
                    continue
                
                await ssh_conn.connect_direct(host, port)
                
            elif action == 'input':
                # Input an SSH weiterleiten
                input_data = message.get('data')
                await ssh_conn.send_input(input_data)
                
            elif action == 'disconnect':
                # SSH-Verbindung trennen
                ssh_conn.disconnect()
                break
                
    except WebSocketDisconnect:
        print(f"🔌 WebSocket getrennt: {connection_id}")
    except Exception as e:
        print(f"❌ SSH WebSocket Fehler: {e}")
    finally:
        # Cleanup
        ssh_conn.disconnect()
        if connection_id in connections:
            del connections[connection_id]
        print(f"🧹 Verbindung bereinigt: {connection_id}")


if __name__ == "__main__":
    print("🏠 HomeLab Dashboard SSH Backend")
    print("=" * 50)
    print(f"Frontend: http://localhost:8000/")
    print(f"Health: http://localhost:8000/health")
    print(f"API: http://localhost:8000/api/servers")
    print(f"Ping: http://localhost:8000/api/ping/SERVER_ID")
    print(f"WebSocket: ws://localhost:8000/ws/ssh")
    print(f"Config: {config_file_path.absolute()}")
    print("=" * 50)
    
    # Config beim Start laden
    load_server_config()
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )