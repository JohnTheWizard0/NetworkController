// Main Dashboard Application
class HomelabDashboard {
    constructor() {
        this.dashboardData = null;
        this.currentFilter = 'all';
        this.currentServiceFilter = 'all';
        this.searchTerm = '';
        this.expandedCards = new Set();
        this.refreshInterval = null;
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
        
        // Load dashboard configuration
        await this.loadDashboardData();
        
        // Initialize UI
        this.setupEventListeners();
        this.renderHosts();
        this.renderServices();
        
        // Start auto-refresh for ping status
        this.startAutoRefresh();
        
        Utils.debugLog('✅ Dashboard initialisiert');
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

    async loadDashboardData() {
        try {
            Utils.debugLog('📡 Lade Dashboard-Daten...');
            const response = await Utils.fetchWithTimeout('/api/dashboard', {}, 3000);
            
            if (!response.ok) {
                throw new Error(`HTTP ${response.status}: ${response.statusText}`);
            }
            
            this.dashboardData = await response.json();
            Utils.debugLog(`✅ ${this.dashboardData.servers.length} Hosts und ${this.dashboardData.services.length} Services geladen`);
            
        } catch (error) {
            Utils.debugLog(`❌ Fehler beim Laden der Dashboard-Daten: ${error.message}`);
            
            // Fallback configuration
            Utils.debugLog('🔄 Verwende Fallback-Konfiguration...');
            this.dashboardData = {
                categories: [
                    { id: "intern", name: "Intern", subnet: "192.168.1.0/24", color: "#2ecc71" }
                ],
                servers: [
                    {
                        hostname: "Konfigurationsfehler",
                        description: "Backend nicht erreichbar",
                        category_id: "intern",
                        host: "127.0.0.1",
                        shared: false,
                        access: { ssh: false },
                        notes: "Dashboard-Konfiguration konnte nicht geladen werden.",
                        status: "offline",
                        category: { name: "Intern", color: "#2ecc71" },
                        services: []
                    }
                ],
                services: []
            };
        }
    }

    startAutoRefresh() {
        // Refresh every 60 seconds
        this.refreshInterval = setInterval(async () => {
            Utils.debugLog('🔄 Auto-Refresh: Lade Dashboard-Daten...');
            await this.loadDashboardData();
            this.renderHosts();
            this.renderServices();
        }, 60000);
        
        Utils.debugLog('⏰ Auto-Refresh gestartet (60s Intervall)');
    }

    stopAutoRefresh() {
        if (this.refreshInterval) {
            clearInterval(this.refreshInterval);
            this.refreshInterval = null;
            Utils.debugLog('⏰ Auto-Refresh gestoppt');
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

        // Host Filter Tabs
        document.querySelectorAll('.filter-tab[data-filter]').forEach(filterTab => {
            filterTab.addEventListener('click', () => {
                this.setFilter(filterTab.dataset.filter);
            });
        });

        // Service Filter Tabs
        document.querySelectorAll('.filter-tab[data-service-filter]').forEach(filterTab => {
            filterTab.addEventListener('click', () => {
                this.setServiceFilter(filterTab.dataset.serviceFilter);
            });
        });

        // Search
        const searchInput = document.getElementById('searchInput');
        if (searchInput) {
            searchInput.addEventListener('input', (e) => {
                this.searchTerm = e.target.value.toLowerCase();
                this.renderHosts();
                this.renderServices();
            });
        }

        // ESC key handlers
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape') {
                if (document.getElementById('terminalModal').style.display === 'flex') {
                    window.sshTerminal.closeTerminal();
                }
            }
        });

        // Click outside modal to close
        document.getElementById('terminalModal').addEventListener('click', (e) => {
            if (e.target === document.getElementById('terminalModal')) {
                window.sshTerminal.closeTerminal();
            }
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
        document.querySelectorAll('.filter-tab[data-filter]').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-filter="${filter}"]`).classList.add('active');
        this.currentFilter = filter;
        this.renderHosts();
    }

    setServiceFilter(filter) {
        document.querySelectorAll('.filter-tab[data-service-filter]').forEach(t => t.classList.remove('active'));
        document.querySelector(`[data-service-filter="${filter}"]`).classList.add('active');
        this.currentServiceFilter = filter;
        this.renderServices();
    }

    filterHosts(hosts) {
        return hosts.filter(host => {
            // Search filter
            if (this.searchTerm) {
                const searchable = `${host.hostname} ${host.description}`.toLowerCase();
                if (!searchable.includes(this.searchTerm)) {
                    return false;
                }
            }

            // Category filter
            switch (this.currentFilter) {
                case 'all':
                    return true;
                case 'intern':
                    return host.category_id === 'intern';
                case 'dmz':
                    return host.category_id === 'dmz';
                case 'shared':
                    return host.shared;
                case 'ssh':
                    return host.access.ssh;
                default:
                    return true;
            }
        });
    }

    filterServices(services) {
        return services.filter(service => {
            // Search filter
            if (this.searchTerm) {
                const searchable = `${service.name} ${service.description} ${service.tags.join(' ')}`.toLowerCase();
                if (!searchable.includes(this.searchTerm)) {
                    return false;
                }
            }

            // Category filter
            if (this.currentServiceFilter === 'all') {
                return true;
            }
            
            return service.category === this.currentServiceFilter;
        });
    }

    renderHosts() {
        const serverContent = document.getElementById('server-content');
        if (!serverContent || !this.dashboardData) return;

        const filteredHosts = this.filterHosts(this.dashboardData.servers);
        
        if (filteredHosts.length === 0) {
            serverContent.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>Keine Hosts gefunden</h3>
                    <p>Versuche einen anderen Filter oder Suchbegriff</p>
                </div>
            `;
            return;
        }

        // Group by category
        const hostsByCategory = {};
        filteredHosts.forEach(host => {
            const categoryId = host.category_id;
            if (!hostsByCategory[categoryId]) {
                hostsByCategory[categoryId] = [];
            }
            hostsByCategory[categoryId].push(host);
        });

        let html = '';
        this.dashboardData.categories.forEach(category => {
            const categoryHosts = hostsByCategory[category.id];
            if (categoryHosts && categoryHosts.length > 0) {
                html += this.renderCategorySection(category, categoryHosts);
            }
        });

        serverContent.innerHTML = html;
        this.attachEventListeners();
    }

    renderServices() {
        const servicesGrid = document.getElementById('services-grid');
        if (!servicesGrid || !this.dashboardData) return;

        const filteredServices = this.filterServices(this.dashboardData.services);
        
        if (filteredServices.length === 0) {
            servicesGrid.innerHTML = `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>Keine Services gefunden</h3>
                    <p>Versuche einen anderen Filter oder Suchbegriff</p>
                </div>
            `;
            return;
        }

        const html = `
            <div class="services-grid">
                ${filteredServices.map(service => this.renderServiceCard(service)).join('')}
            </div>
        `;

        servicesGrid.innerHTML = html;
    }

    renderCategorySection(category, hosts) {
        const isCollapsed = false;
        
        return `
            <div class="network-section ${isCollapsed ? 'collapsed' : ''}">
                <div class="network-header" onclick="dashboard.toggleCategorySection(this)">
                    <div class="network-indicator" style="background-color: ${category.color}"></div>
                    <div>
                        <div class="network-title">▼ ${category.name}</div>
                        <div class="network-subtitle">(${category.subnet}) • ${hosts.length} Hosts</div>
                    </div>
                    <div class="expand-icon">▼</div>
                </div>
                <div class="server-grid">
                    ${hosts.map(host => this.renderHostCard(host)).join('')}
                </div>
            </div>
        `;
    }

    renderHostCard(host) {
        const isExpanded = this.expandedCards.has(host.hostname);
        
        return `
            <div class="server-card ${isExpanded ? 'expanded' : ''}" data-server-id="${host.hostname}">
                <div class="server-header">
                    <div class="server-name-container">
                        <span class="server-name">${host.hostname}</span>
                        <span class="server-ip-badge">[${host.host}]</span>
                    </div>
                    <div class="server-indicators">
                        <div class="status-indicator ${host.status}" title="Status: ${host.status}"></div>
                        ${host.shared ? '<span class="shared-indicator" title="Shared Server">⚠️</span>' : ''}
                    </div>
                </div>
                
                <div class="server-services">${host.description}</div>
                
                <div class="server-actions">
                    ${host.access.ssh ? `<button class="action-btn ssh" onclick="dashboard.openSSH('${host.hostname}')">SSH</button>` : ''}
                    <button class="action-btn" onclick="dashboard.toggleHostCard('${host.hostname}')">${isExpanded ? 'Collapse ▲' : 'Expand ▼'}</button>
                </div>
                
                ${isExpanded ? this.renderHostDetails(host) : ''}
            </div>
        `;
    }

    renderHostDetails(host) {
        return `
            <div class="server-details">
                ${host.services.length > 0 ? `
                    <div class="host-services">
                        <div class="detail-title">🚀 Services auf diesem Host:</div>
                        <div class="service-list">
                            ${host.services.map(service => this.renderServiceItem(service)).join('')}
                        </div>
                    </div>
                ` : ''}
                
                ${host.notes ? `
                    <div class="server-notes">
                        📝 ${host.notes}
                    </div>
                ` : ''}
            </div>
        `;
    }

    renderServiceItem(service) {
        return `
            <div class="service-item">
                <div class="service-item-favicon">🌐</div>
                <div class="service-item-info">
                    <div class="service-item-name">${service.name}</div>
                    ${service.port ? `<div class="service-item-port">Port ${service.port}</div>` : ''}
                </div>
                ${service.url ? `
                    <a href="${service.url}" target="_blank" class="service-item-link">↗</a>
                ` : ''}
            </div>
        `;
    }

    renderServiceCard(service) {
        const host = this.dashboardData.servers.find(s => s.hostname === service.hostname);
        const hostStatus = host ? host.status : 'unknown';
            
        return `
            <div class="service-card">
                <div class="service-status-indicator ${hostStatus}"></div>
                <div class="service-header">
                    <div class="service-favicon icon">🌐</div>
                    <div class="service-info">
                        <div class="service-name">${service.name}</div>
                        <div class="service-host">${host ? host.hostname : 'Unbekannter Host'}</div>
                    </div>
                </div>
                
                <div class="service-description">${service.description}</div>
                
                ${service.url ? `
                    <a href="${service.url}" target="_blank" class="service-url">
                        Service öffnen ↗
                    </a>
                ` : ''}
                
                ${service.tags.length > 0 ? `
                    <div class="service-tags">
                        ${service.tags.map(tag => `<span class="service-tag">${tag}</span>`).join('')}
                    </div>
                ` : ''}
            </div>
        `;
    }

    toggleCategorySection(header) {
        const section = header.parentElement;
        section.classList.toggle('collapsed');
    }

    toggleHostCard(hostname) {
        if (this.expandedCards.has(hostname)) {
            this.expandedCards.delete(hostname);
        } else {
            this.expandedCards.add(hostname);
        }
        this.renderHosts();
    }

    openSSH(hostname) {
        Utils.debugLog(`🔑 SSH-Button geklickt für Host: ${hostname}`);
        
        const host = this.dashboardData.servers.find(s => s.hostname === hostname);
        if (!host) {
            Utils.debugLog(`❌ Host ${hostname} nicht gefunden!`);
            return;
        }
        
        Utils.debugLog(`✅ Host gefunden: ${host.hostname} (${host.host})`);
        
        // Convert to old format for SSH terminal compatibility
        const legacyServer = {
            id: host.hostname,
            name: host.hostname,
            host: host.host,
            access: host.access
        };
        
        window.sshTerminal.openSSHTerminal(legacyServer);
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