// Main Dashboard Application
class HomelabDashboard {
    constructor() {
        this.serverData = null;
        this.currentFilter = 'all';
        this.searchTerm = '';
        this.expandedCards = new Set();
        this.statusRefreshInterval = null;
    }

    async initialize() {
        Utils.debugLog('🚀 Dashboard wird geladen...');
        
        // Check xterm.js availability
        await this.checkTerminalSupport();
        
        // Check WebSocket support
        if (typeof WebSocket === 'undefined') {
            Utils.debugLog('❌ WebSocket nicht unterstützt!');
            Utils.showToast('Fehler: WebSocket nicht unterstützt');
            return;
        }
        Utils.debugLog('✅ WebSocket unterstützt');
        
        // Load server configuration
        await this.loadServerConfig();
        
        // Initialize UI
        this.setupEventListeners();
        this.renderServers();
        
        // Start status refresh
        this.startStatusRefresh();
        
        Utils.debugLog('✅ Server-Dashboard initialisiert');
    }

    async checkTerminalSupport() {
        if (typeof Terminal === 'undefined') {
            Utils.debugLog('❌ xterm.js nicht geladen! Versuche alternativen CDN...');
            
            try {
                await this.loadAlternativeTerminal();
                Utils.debugLog('✅ xterm.js von alternativem CDN geladen');
            } catch (error) {
                Utils.debugLog('❌ xterm.js konnte von keinem CDN geladen werden');
                Utils.showToast('SSH-Terminal nicht verfügbar. xterm.js konnte nicht geladen werden.');
            }
        } else {
            Utils.debugLog('✅ xterm.js erfolgreich geladen');
        }
    }

    loadAlternativeTerminal() {
        return new Promise((resolve, reject) => {
            const script1 = document.createElement('script');
            script1.src = 'https://unpkg.com/xterm@5.3.0/lib/xterm.js';
            script1.onload = () => {
                const script2 = document.createElement('script');
                script2.src = 'https://unpkg.com/xterm-addon-fit@0.8.0/lib/xterm-addon-fit.js';
                script2.onload = () => resolve();
                script2.onerror = () => reject(new Error('FitAddon load failed'));
                document.head.appendChild(script2);
            };
            script1.onerror = () => reject(new Error('xterm.js load failed'));
            document.head.appendChild(script1);
        });
    }

    async loadServerConfig() {
        try {
            Utils.debugLog('📡 Lade Server-Konfiguration...');
            const response = await fetch('/api/servers');
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.serverData = await response.json();
            Utils.debugLog(`✅ ${this.serverData.servers.length} Server geladen`);
            
        } catch (error) {
            Utils.debugLog(`❌ Fehler beim Laden der Server-Konfiguration: ${error.message}`);
            
            // Fallback: Use embedded config if API fails
            Utils.debugLog('🔄 Verwende Fallback-Konfiguration...');
            this.serverData = {
                networks: [
                    { name: "Intern", subnet: "192.168.1.0/24", color: "#2ecc71" },
                    { name: "DMZ", subnet: "192.168.7.0/24", color: "#e74c3c" }
                ],
                servers: [
                    {
                        id: "error",
                        name: "Konfigurationsfehler",
                        services: "Backend nicht erreichbar",
                        network: "Intern",
                        host: "127.0.0.1",
                        dns: ["localhost"],
                        shared: false,
                        access: { ssh: false },
                        ports: [],
                        notes: "Server-Konfiguration konnte nicht geladen werden. Backend prüfen.",
                        status: "offline"
                    }
                ]
            };
        }
    }

    startStatusRefresh() {
        // Status alle 30 Sekunden aktualisieren
        this.statusRefreshInterval = setInterval(async () => {
            Utils.debugLog('🔄 Aktualisiere Server-Status...');
            await this.refreshServerStatus();
        }, 30000);
        
        Utils.debugLog('✅ Status-Refresh gestartet (30s Intervall)');
    }

    async refreshServerStatus() {
        try {
            const response = await fetch('/api/servers');
            if (!response.ok) return;
            
            const newData = await response.json();
            
            // Status in aktuellen Daten aktualisieren
            newData.servers.forEach(newServer => {
                const oldServer = this.serverData.servers.find(s => s.id === newServer.id);
                if (oldServer && oldServer.status !== newServer.status) {
                    oldServer.status = newServer.status;
                    Utils.debugLog(`📊 Status geändert - ${newServer.name}: ${newServer.status}`);
                }
            });
            
            // UI aktualisieren
            this.renderServers();
            
        } catch (error) {
            Utils.debugLog(`❌ Status-Refresh fehlgeschlagen: ${error.message}`);
        }
    }

    setupEventListeners() {
        // Tab Switching
        document.querySelectorAll('.tab').forEach(tab => {
            tab.addEventListener('click', (e) => {
                e.preventDefault();
                this.switchTab(tab.dataset.tab);
            });
        });

        // Filter Tabs
        document.querySelectorAll('.filter-tab').forEach(filterTab => {
            filterTab.addEventListener('click', () => {
                this.setFilter(filterTab.dataset.filter);
            });
        });

        // Search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase();
                this.renderServers();
            });
        }

        // ESC key handlers
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                // Close terminal
                if (document.getElementById('terminalModal').style.display === 'flex') {
                    window.sshTerminal.closeTerminal();
                }
            }
        });

        // Click outside modal to close
        document.querySelectorAll('.modal').forEach(modal => {
            modal.addEventListener('click', (e) => {
                if (e.target === modal) {
                    modal.style.display = 'none';
                }
            });
        });
    }

    switchTab(tabName) {
        // Update active tab
        document.querySelectorAll('.tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-tab="${tabName}"]`).classList.add('active');
        
        // Show/hide content
        document.querySelectorAll('.tab-content').forEach(content => {
            content.style.display = 'none';
        });
        
        const targetContent = document.getElementById(`${tabName}-content`);
        if (targetContent) {
            targetContent.style.display = 'block';
        }
    }

    setFilter(filter) {
        document.querySelectorAll('.filter-tab').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
        this.currentFilter = filter;
        this.renderServers();
    }

    filterServers(servers) {
        return servers.filter(server => {
            // Search filter
            if (this.searchTerm) {
                const searchable = `${server.name} ${server.services} ${server.dns.join(' ')}`.toLowerCase();
                if (!searchable.includes(this.searchTerm)) {
                    return false;
                }
            }

            // Category filter
            switch (this.currentFilter) {
                case 'all':
                    return true;
                case 'intern':
                    return server.network === 'Intern';
                case 'dmz':
                    return server.network === 'DMZ';
                case 'shared':
                    return server.shared;
                case 'ssh':
                    return server.access.ssh;
                default:
                    return true;
            }
        });
    }

    renderServers() {
        const serverContent = document.getElementById('server-content');
        if (!serverContent || !this.serverData) return;

        const filteredServers = this.filterServers(this.serverData.servers);
        
        if (filteredServers.length === 0) {
            serverContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>Keine Server gefunden</h3>
                    <p>Versuche einen anderen Filter oder Suchbegriff</p>
                </div>
            `;
            return;
        }

        // Group by network
        const serversByNetwork = {};
        filteredServers.forEach(server => {
            if (!serversByNetwork[server.network]) {
                serversByNetwork[server.network] = [];
            }
            serversByNetwork[server.network].push(server);
        });

        let html = '';
        this.serverData.networks.forEach(network => {
            const networkServers = serversByNetwork[network.name];
            if (networkServers && networkServers.length > 0) {
                html += this.renderNetworkSection(network, networkServers);
            }
        });

        serverContent.innerHTML = html;
        this.attachEventListeners();
    }

    renderNetworkSection(network, servers) {
        const isCollapsed = false;
        
        return `
            <div class="network-section ${isCollapsed ? 'collapsed' : ''}">
                <div class="network-header" onclick="dashboard.toggleNetworkSection(this)">
                    <div class="network-indicator" style="background-color: ${network.color}"></div>
                    <div>
                        <div class="network-title">▼ ${network.name}</div>
                        <div class="network-subtitle">(${network.subnet}) • ${servers.length} Server</div>
                    </div>
                    <div class="expand-icon">▼</div>
                </div>
                <div class="server-grid">
                    ${servers.map(server => this.renderServerCard(server)).join('')}
                </div>
            </div>
        `;
    }

    renderServerCard(server) {
        const isExpanded = this.expandedCards.has(server.id);
        
        return `
            <div class="server-card ${isExpanded ? 'expanded' : ''}" data-server-id="${server.id}">
                <div class="server-header">
                    <div class="server-name">${server.name} <span class="server-ip-inline">[${server.host}]</span></div>
                    <div class="server-indicators">
                        <div class="status-indicator ${server.status}" title="Status: ${server.status}"></div>
                        ${server.shared ? '<span class="shared-indicator" title="Shared Server">⚠️</span>' : ''}
                    </div>
                </div>
                
                <div class="server-services">${server.services}</div>
                
                <div class="server-dns">
                    <a href="https://${server.dns[0]}" target="_blank" class="dns-link">
                        ${server.dns[0]} ↗
                    </a>
                </div>
                
                <div class="server-actions">
                    ${server.access.ssh ? `<button class="action-btn ssh" onclick="dashboard.openSSH('${server.id}')">SSH</button>` : ''}
                    <button class="action-btn ping" onclick="dashboard.pingServer('${server.id}')">Ping</button>
                    <button class="action-btn" onclick="dashboard.toggleServerCard('${server.id}')">${isExpanded ? 'Collapse ▲' : 'Expand ▼'}</button>
                </div>
                
                ${isExpanded ? this.renderServerDetails(server) : ''}
            </div>
        `;
    }

    renderServerDetails(server) {
        return `
            <div class="server-details">
                <div class="detail-section">
                    <div class="detail-title">DNS:</div>
                    <ul class="detail-list">
                        ${server.dns.map(dns => `
                            <li class="detail-item">
                                • <a href="https://${dns}" target="_blank" class="dns-link">${dns}</a>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                
                <div class="detail-section">
                    <div class="detail-title">Ports:</div>
                    <ul class="detail-list">
                        ${server.ports.map(port => `
                            <li class="detail-item">
                                • :${port.number} (${port.service})
                                <a href="http://${server.host}:${port.number}" target="_blank" class="port-link">↗</a>
                            </li>
                        `).join('')}
                    </ul>
                </div>
                
                <div class="detail-section">
                    <div class="detail-title">IP:</div>
                    <div class="server-ip" onclick="Utils.copyToClipboard('${server.host}')">${server.host} 📋</div>
                </div>
                
                ${server.notes ? `
                    <div class="server-notes">
                        📝 ${server.notes}
                    </div>
                ` : ''}
            </div>
        `;
    }

    toggleNetworkSection(header) {
        const section = header.parentElement;
        section.classList.toggle('collapsed');
    }

    toggleServerCard(serverId) {
        if (this.expandedCards.has(serverId)) {
            this.expandedCards.delete(serverId);
        } else {
            this.expandedCards.add(serverId);
        }
        this.renderServers();
    }

    async pingServer(serverId) {
        Utils.debugLog(`🏓 Ping Server: ${serverId}`);
        
        try {
            const response = await fetch(`/api/ping/${serverId}`);
            const result = await response.json();
            
            const statusText = result.status === 'online' ? 'Online ✅' : 'Offline ❌';
            Utils.showToast(`${serverId}: ${statusText}`, result.status === 'online' ? 'success' : 'error');
            
            // Status in UI sofort aktualisieren
            const server = this.serverData.servers.find(s => s.id === serverId);
            if (server) {
                server.status = result.status;
                this.renderServers();
            }
            
        } catch (error) {
            Utils.debugLog(`❌ Ping fehlgeschlagen: ${error.message}`);
            Utils.showToast('Ping fehlgeschlagen', 'error');
        }
    }

    openSSH(serverId) {
        Utils.debugLog(`🔑 SSH-Button geklickt für Server: ${serverId}`);
        
        const server = this.serverData.servers.find(s => s.id === serverId);
        if (!server) {
            Utils.debugLog(`❌ Server ${serverId} nicht gefunden!`);
            return;
        }
        
        Utils.debugLog(`✅ Server gefunden: ${server.name} (${server.host})`);
        
        // Direkt SSH-Terminal öffnen (ohne Modal)
        window.sshTerminal.openSSHTerminal(server);
    }

    attachEventListeners() {
        // Re-attach any dynamic event listeners if needed
    }
}

// Initialize dashboard when DOM is ready
document.addEventListener('DOMContentLoaded', async () => {
    window.dashboard = new HomelabDashboard();
    await window.dashboard.initialize();
});

// Global functions for HTML onclick handlers
function showSettings() {
    Utils.showToast('Einstellungen folgen in Phase 2');
}