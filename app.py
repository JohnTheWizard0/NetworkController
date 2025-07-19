#!/usr/bin/env python3
"""
HomeLab Dashboard SSH Backend
FastAPI + WebSocket + Paramiko SSH Terminal
"""

import asyncio
import json
import threading
from typing import Dict, Optional

import paramiko
from fastapi import FastAPI, WebSocket, WebSocketDisconnect
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

    async def connect(self, host: str, username: str, port: int = 22, password: str = None, key_path: str = None):
        """SSH-Verbindung aufbauen"""
        try:
            self.ssh_client = paramiko.SSHClient()
            self.ssh_client.set_missing_host_key_policy(paramiko.AutoAddPolicy())
            
            # Verbindungsparameter
            connect_kwargs = {
                'hostname': host,
                'port': port,
                'username': username,
                'timeout': 10
            }
            
            # Authentifizierung
            if password:
                connect_kwargs['password'] = password
            elif key_path:
                connect_kwargs['key_filename'] = key_path
            # Sonst SSH-Agent oder Standard-Keys verwenden
            
            # Verbinden
            self.ssh_client.connect(**connect_kwargs)
            
            # Interactive Shell öffnen
            self.ssh_channel = self.ssh_client.invoke_shell(
                term='xterm-256color',
                width=120,
                height=30
            )
            
            self.connected = True
            
            await self.websocket.send_text(json.dumps({
                'type': 'connected',
                'message': f'SSH connected to {username}@{host}'
            }))
            
            # Output-Thread starten
            self.output_thread = threading.Thread(target=self._read_ssh_output, daemon=True)
            self.output_thread.start()
            
        except Exception as e:
            await self.websocket.send_text(json.dumps({
                'type': 'error',
                'message': f'SSH connection failed: {str(e)}'
            }))

    def _read_ssh_output(self):
        """SSH-Output lesen und an WebSocket weiterleiten"""
        try:
            while self.connected and self.ssh_channel:
                if self.ssh_channel.recv_ready():
                    data = self.ssh_channel.recv(1024).decode('utf-8', errors='ignore')
                    if data:
                        # Async send von sync Thread
                        asyncio.run_coroutine_threadsafe(
                            self.websocket.send_text(json.dumps({
                                'type': 'output',
                                'data': data
                            })),
                            asyncio.get_event_loop()
                        )
                else:
                    # Kurz warten wenn keine Daten
                    threading.Event().wait(0.01)
                    
        except Exception as e:
            # Verbindung verloren
            asyncio.run_coroutine_threadsafe(
                self.websocket.send_text(json.dumps({
                    'type': 'disconnected',
                    'message': f'SSH connection lost: {str(e)}'
                })),
                asyncio.get_event_loop()
            )

    async def send_input(self, data: str):
        """Input an SSH-Channel senden"""
        if self.connected and self.ssh_channel:
            try:
                self.ssh_channel.send(data)
            except Exception as e:
                await self.websocket.send_text(json.dumps({
                    'type': 'error',
                    'message': f'Failed to send input: {str(e)}'
                }))

    def disconnect(self):
        """SSH-Verbindung schließen"""
        self.connected = False
        
        if self.ssh_channel:
            self.ssh_channel.close()
        
        if self.ssh_client:
            self.ssh_client.close()


# FastAPI App
app = FastAPI(title="HomeLab Dashboard")

# Static Files - KORRIGIERT
app.mount("/static", StaticFiles(directory="static"), name="static")

# In-Memory Connection Store
connections: Dict[str, SSHConnection] = {}


@app.get("/")
async def root():
    """Redirect to static frontend - KORRIGIERT"""
    return RedirectResponse(url="/static/index.html")


@app.get("/health")
async def health_check():
    """Health check endpoint"""
    return {"status": "ok", "message": "HomeLab Dashboard is running"}


@app.websocket("/ws/ssh")
async def ssh_websocket(websocket: WebSocket):
    """SSH WebSocket Handler"""
    await websocket.accept()
    connection_id = id(websocket)
    ssh_conn = SSHConnection(websocket)
    connections[connection_id] = ssh_conn
    
    try:
        while True:
            # WebSocket Message empfangen
            data = await websocket.receive_text()
            message = json.loads(data)
            
            action = message.get('action')
            
            if action == 'connect':
                # SSH-Verbindung aufbauen
                host = message.get('host')
                username = message.get('username')
                port = message.get('port', 22)
                password = message.get('password')  # Optional
                
                await ssh_conn.connect(host, username, port, password)
                
            elif action == 'input':
                # Input an SSH weiterleiten
                input_data = message.get('data')
                await ssh_conn.send_input(input_data)
                
            elif action == 'disconnect':
                # SSH-Verbindung trennen
                ssh_conn.disconnect()
                break
                
    except WebSocketDisconnect:
        # WebSocket getrennt
        pass
    except Exception as e:
        print(f"SSH WebSocket error: {e}")
    finally:
        # Cleanup
        ssh_conn.disconnect()
        if connection_id in connections:
            del connections[connection_id]


if __name__ == "__main__":
    print("🏠 HomeLab Dashboard SSH Backend")
    print("Frontend: http://localhost:8000/")
    print("Health: http://localhost:8000/health")
    print("WebSocket: ws://localhost:8000/ws/ssh")
    
    uvicorn.run(
        app,
        host="0.0.0.0",
        port=8000,
        log_level="info"
    )