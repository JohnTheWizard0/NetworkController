// Terminal-specific functionality
class SSHTerminal {
    constructor() {
        this.terminal = null;
        this.fitAddon = null;
        this.socket = null;
        this.currentServer = null;
    }

    async openSSHTerminal(server) {
        Utils.debugLog(`🖥️ Öffne SSH-Terminal für ${server.name}`);
        
        // Check if Terminal is available
        if (typeof Terminal === 'undefined') {
            Utils.debugLog('❌ Terminal nicht verfügbar');
            Utils.showToast('SSH-Terminal nicht verfügbar. xterm.js konnte nicht geladen werden.');
            return;
        }
        
        this.currentServer = server;
        
        // Prompt for username
        const username = prompt(`SSH Benutzername für ${server.name} [${server.host}]:`, server.access.ssh_user || 'root');
        if (!username) {
            Utils.debugLog('❌ Kein Benutzername eingegeben');
            return;
        }
        
        // Initialize terminal if not exists
        if (!this.terminal) {
            Utils.debugLog('🔧 Initialisiere Terminal...');
            if (!this.initializeTerminal()) {
                return;
            }
        }
        
        // Show modal
        document.getElementById('terminalModal').style.display = 'flex';
        document.getElementById('terminalTitle').textContent = `SSH - ${username}@${server.name} [${server.host}]`;
        
        // Fit terminal to container
        setTimeout(() => {
            if (this.fitAddon) {
                this.fitAddon.fit();
                Utils.debugLog('📐 Terminal-Größe angepasst');
            }
            this.connectSSH(server, username);
        }, 100);
    }

    initializeTerminal() {
        try {
            // Check if Terminal is available
            if (typeof Terminal === 'undefined') {
                Utils.debugLog('❌ Terminal-Klasse nicht verfügbar');
                return false;
            }
            
            // Create terminal instance
            this.terminal = new Terminal({
                cursorBlink: true,
                fontSize: 14,
                fontFamily: '"Cascadia Code", "Fira Code", "DejaVu Sans Mono", monospace',
                theme: {
                    background: '#1e1e1e',
                    foreground: '#d4d4d4',
                    cursor: '#ffffff',
                    selection: '#264f78',
                    black: '#000000',
                    red: '#cd3131',
                    green: '#0dbc79',
                    yellow: '#e5e510',
                    blue: '#2472c8',
                    magenta: '#bc3fbc',
                    cyan: '#11a8cd',
                    white: '#e5e5e5',
                    brightBlack: '#666666',
                    brightRed: '#f14c4c',
                    brightGreen: '#23d18b',
                    brightYellow: '#f5f543',
                    brightBlue: '#3b8eea',
                    brightMagenta: '#d670d6',
                    brightCyan: '#29b8db',
                    brightWhite: '#e5e5e5'
                }
            });

            // Add fit addon if available
            if (typeof FitAddon !== 'undefined' && FitAddon.FitAddon) {
                this.fitAddon = new FitAddon.FitAddon();
                this.terminal.loadAddon(this.fitAddon);
                Utils.debugLog('✅ FitAddon geladen');
            } else if (window.FitAddon) {
                this.fitAddon = new window.FitAddon();
                this.terminal.loadAddon(this.fitAddon);
                Utils.debugLog('✅ FitAddon (window) geladen');
            } else {
                Utils.debugLog('⚠️ FitAddon nicht verfügbar');
            }

            // Open terminal in container
            this.terminal.open(document.getElementById('terminal'));
            Utils.debugLog('✅ Terminal erfolgreich initialisiert');
            
            return true;
            
        } catch (error) {
            Utils.debugLog(`❌ Terminal-Initialisierung fehlgeschlagen: ${error.message}`);
            Utils.showToast('Fehler beim Initialisieren des Terminals');
            return false;
        }
    }

    connectSSH(server, username) {
        Utils.debugLog(`🔌 Starte SSH-Verbindung zu ${username}@${server.host}...`);
        this.updateConnectionStatus('connecting', 'Verbinde...');
        
        // Store username for later use
        this.currentUsername = username;
        this.currentServer = server;
        
        // Create WebSocket connection to backend
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws/ssh`;
        
        Utils.debugLog(`🔗 WebSocket-URL: ${wsUrl}`);
        
        try {
            this.socket = new WebSocket(wsUrl);
            
            this.socket.onopen = () => {
                Utils.debugLog('✅ WebSocket-Verbindung hergestellt');
                this.updateConnectionStatus('connected', 'Verbunden');
                
                // Send SSH connection request WITH username
                const sshRequest = {
                    action: 'connect',
                    host: server.host,
                    port: 22,
                    username: username  // Include username
                };
                
                Utils.debugLog(`📤 Sende SSH-Request für ${username}@${server.host}`);
                this.socket.send(JSON.stringify(sshRequest));
                
                // Clear terminal and show connection info
                this.terminal.clear();
                this.terminal.writeln('\x1b[1;36m╔══════════════════════════════════════╗\x1b[0m');
                this.terminal.writeln('\x1b[1;36m║        HomeLab SSH Terminal          ║\x1b[0m');
                this.terminal.writeln('\x1b[1;36m╚══════════════════════════════════════╝\x1b[0m');
                this.terminal.writeln('');
                this.terminal.writeln(`\x1b[32mVerbinde zu ${username}@${server.host}...\x1b[0m`);
            };
            
            this.socket.onmessage = (event) => {
                try {
                    const data = JSON.parse(event.data);
                    Utils.debugLog(`📥 WebSocket-Nachricht: ${data.type}`);
                    
                    switch(data.type) {
                        case 'output':
                            this.terminal.write(data.data);
                            break;
                        case 'connected':
                            this.updateConnectionStatus('connected', 'SSH Aktiv');
                            document.getElementById('terminalInfo').textContent = `SSH Session - ${this.currentUsername}@${this.currentServer.name}`;
                            Utils.debugLog('🎉 SSH-Verbindung erfolgreich!');
                            break;
                        case 'error':
                            this.terminal.writeln(`\x1b[31mFehler: ${data.message}\x1b[0m`);
                            this.updateConnectionStatus('disconnected', 'Fehler');
                            Utils.debugLog(`❌ SSH-Fehler: ${data.message}`);
                            break;
                        case 'disconnected':
                            this.terminal.writeln('\x1b[33mVerbindung getrennt.\x1b[0m');
                            this.updateConnectionStatus('disconnected', 'Getrennt');
                            Utils.debugLog('🔌 SSH-Verbindung getrennt');
                            break;
                    }
                } catch (parseError) {
                    Utils.debugLog(`❌ JSON-Parse-Fehler: ${parseError.message}`);
                }
            };
            
            this.socket.onerror = (error) => {
                Utils.debugLog(`❌ WebSocket-Fehler: ${error}`);
                this.terminal.writeln('\x1b[31mWebSocket-Fehler: Backend nicht erreichbar\x1b[0m');
                this.terminal.writeln('\x1b[33mHinweis: SSH-Terminal benötigt Backend-Integration\x1b[0m');
                this.updateConnectionStatus('disconnected', 'Backend fehlt');
            };
            
            this.socket.onclose = (event) => {
                Utils.debugLog(`🔌 WebSocket geschlossen: Code ${event.code}, Reason: ${event.reason}`);
                this.updateConnectionStatus('disconnected', 'Getrennt');
                document.getElementById('terminalInfo').textContent = 'Verbindung geschlossen';
            };
            
            // Handle terminal input - This is crucial for interactive SSH
            this.terminal.onData((data) => {
                if (this.socket && this.socket.readyState === WebSocket.OPEN) {
                    this.socket.send(JSON.stringify({
                        action: 'input',
                        data: data
                    }));
                }
            });
            
        } catch (error) {
            Utils.debugLog(`❌ WebSocket-Initialisierung fehlgeschlagen: ${error.message}`);
            Utils.showToast('Fehler beim Verbinden zum Backend');
        }
    }

    updateConnectionStatus(status, text) {
        const statusDot = document.getElementById('connectionStatus');
        const statusText = document.getElementById('connectionText');
        
        if (statusDot && statusText) {
            statusDot.className = `status-dot ${status}`;
            statusText.textContent = text;
        }
        
        Utils.debugLog(`🔄 Verbindungsstatus: ${status} - ${text}`);
    }

    clearTerminal() {
        if (this.terminal) {
            this.terminal.clear();
            Utils.debugLog('🧹 Terminal geleert');
        }
    }

    disconnectSSH() {
        if (this.socket) {
            this.socket.close();
            Utils.debugLog('🔌 SSH-Verbindung manuell getrennt');
        }
        this.updateConnectionStatus('disconnected', 'Getrennt');
        if (this.terminal) {
            this.terminal.writeln('\x1b[33mVerbindung manuell getrennt.\x1b[0m');
        }
    }

    closeTerminal() {
        Utils.debugLog('❌ Terminal schließen');
        this.disconnectSSH();
        document.getElementById('terminalModal').style.display = 'none';
    }
}

// Initialize terminal instance
window.sshTerminal = new SSHTerminal();

// Global terminal functions for HTML onclick handlers
function clearTerminal() {
    window.sshTerminal.clearTerminal();
}

function disconnectSSH() {
    window.sshTerminal.disconnectSSH();
}

function closeTerminal() {
    window.sshTerminal.closeTerminal();
}

// Handle window resize
window.addEventListener('resize', function() {
    if (window.sshTerminal.fitAddon && document.getElementById('terminalModal').style.display === 'flex') {
        setTimeout(() => window.sshTerminal.fitAddon.fit(), 100);
    }
});