// Main Dashboard Application with CRUD Management
class HomelabDashboard {
    constructor() {
        this.dashboardData = null;
        this.currentFilter = 'all';
        this.currentServiceFilter = 'all';
        this.searchTerm = '';
        this.expandedCards = new Set();
        this.refreshInterval = null;
        this.draggedCategory = null;
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
            Utils.debugLog(`✅ ${this.dashboardData.servers.length} Hosts, ${this.dashboardData.services.length} Services, ${this.dashboardData.service_categories.length} Service-Kategorien geladen`);
            
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
                services: [],
                service_categories: []
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
                this.closeAllModals();
            }
        });

        // Modal outside click handlers
        document.addEventListener('click', (e) => {
            if (e.target.classList.contains('modal')) {
                this.closeAllModals();
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

        // Update service filters when switching to services tab
        if (tabName === 'services') {
            this.updateServiceFilters();
        }
    }

    updateServiceFilters() {
        const filterContainer = document.querySelector('#services-content .filter-tabs');
        if (!filterContainer || !this.dashboardData?.service_categories) return;

        const categories = this.dashboardData.service_categories;
        
        let filterHTML = '<div class="filter-tab active" data-service-filter="all">Alle</div>';
        categories.forEach(category => {
            filterHTML += `<div class="filter-tab" data-service-filter="${category.id}">${category.icon} ${category.name}</div>`;
        });

        filterContainer.innerHTML = filterHTML;

        // Re-attach event listeners
        filterContainer.querySelectorAll('.filter-tab[data-service-filter]').forEach(filterTab => {
            filterTab.addEventListener('click', () => {
                this.setServiceFilter(filterTab.dataset.serviceFilter);
            });
        });
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

        let html = `
            <div class="management-actions">
                <button class="btn btn-primary" onclick="dashboard.showAddHostModal()">+ Host hinzufügen</button>
            </div>
        `;

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
        const servicesContent = document.getElementById('services-content');
        if (!servicesContent || !this.dashboardData) return;

        const filteredServices = this.filterServices(this.dashboardData.services);
        
        // Management actions
        let html = `
            <div class="filter-tabs">
                <div class="filter-tab active" data-service-filter="all">Alle</div>
            </div>
            <div class="management-actions">
                <button class="btn btn-primary" onclick="dashboard.showAddServiceModal()">+ Service hinzufügen</button>
                <button class="btn btn-secondary" onclick="dashboard.showManageCategoriesModal()">Kategorien verwalten</button>
            </div>
        `;
        
        if (filteredServices.length === 0) {
            html += `
                <div class="empty-state">
                    <div class="empty-icon">🔍</div>
                    <h3>Keine Services gefunden</h3>
                    <p>Versuche einen anderen Filter oder Suchbegriff</p>
                </div>
            `;
        } else {
            // Group services by category
            const servicesByCategory = {};
            filteredServices.forEach(service => {
                const categoryId = service.category;
                if (!servicesByCategory[categoryId]) {
                    servicesByCategory[categoryId] = [];
                }
                servicesByCategory[categoryId].push(service);
            });

            // Render categories in order
            this.dashboardData.service_categories.forEach(category => {
                const categoryServices = servicesByCategory[category.id];
                if (categoryServices && categoryServices.length > 0) {
                    html += this.renderServiceCategorySection(category, categoryServices);
                }
            });

            // Render services without category
            const uncategorizedServices = servicesByCategory['undefined'] || servicesByCategory[''] || [];
            if (uncategorizedServices.length > 0) {
                html += this.renderServiceCategorySection(
                    {id: 'uncategorized', name: 'Unkategorisiert', icon: '❓', color: '#95a5a6'},
                    uncategorizedServices
                );
            }
        }

        servicesContent.innerHTML = html;
        this.updateServiceFilters();
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

    renderServiceCategorySection(category, services) {
        return `
            <div class="service-category-section">
                <div class="service-category-header" style="border-left: 4px solid ${category.color}">
                    <div class="service-category-icon">${category.icon}</div>
                    <div class="service-category-title">${category.name}</div>
                    <div class="service-category-count">${services.length} Services</div>
                </div>
                <div class="services-grid">
                    ${services.map(service => this.renderServiceCard(service)).join('')}
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
                    <button class="action-btn" onclick="dashboard.editHost('${host.hostname}')">✏️ Edit</button>
                    <button class="action-btn" onclick="dashboard.deleteHost('${host.hostname}')">🗑️ Delete</button>
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
        const categoryInfo = service.category_info || {};
            
        return `
            <div class="service-card">
                <div class="service-status-indicator ${hostStatus}"></div>
                <div class="service-header">
                    <div class="service-favicon icon">${categoryInfo.icon || '🌐'}</div>
                    <div class="service-info">
                        <div class="service-name">${service.name}</div>
                        <div class="service-host">${host ? host.hostname : 'Unbekannter Host'}</div>
                    </div>
                </div>
                
                <div class="service-description">${service.description}</div>
                
                <div class="service-actions">
                    ${service.url ? `<a href="${service.url}" target="_blank" class="service-url">Service öffnen ↗</a>` : ''}
                    <button class="action-btn" onclick="dashboard.editService('${service.name}')">✏️ Edit</button>
                    <button class="action-btn" onclick="dashboard.deleteService('${service.name}')">🗑️ Delete</button>
                </div>
                
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

    // CRUD Modal Methods
    showAddHostModal() {
        this.showHostModal();
    }

    showAddServiceModal() {
        this.showServiceModal();
    }

    showManageCategoriesModal() {
        this.showCategoriesModal();
    }

    editHost(hostname) {
        const host = this.dashboardData.servers.find(s => s.hostname === hostname);
        if (host) {
            this.showHostModal(host);
        }
    }

    editService(serviceName) {
        const service = this.dashboardData.services.find(s => s.name === serviceName);
        if (service) {
            this.showServiceModal(service);
        }
    }

    async deleteHost(hostname) {
        if (!confirm(`Host "${hostname}" wirklich löschen?`)) return;

        try {
            const response = await fetch(`/api/servers/${hostname}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                Utils.showToast('Host erfolgreich gelöscht', 'success');
                await this.loadDashboardData();
                this.renderHosts();
            } else {
                Utils.showToast('Fehler beim Löschen des Hosts', 'error');
            }
        } catch (error) {
            Utils.showToast('Netzwerkfehler beim Löschen', 'error');
        }
    }

    async deleteService(serviceName) {
        if (!confirm(`Service "${serviceName}" wirklich löschen?`)) return;

        try {
            const response = await fetch(`/api/services/${serviceName}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                Utils.showToast('Service erfolgreich gelöscht', 'success');
                await this.loadDashboardData();
                this.renderServices();
            } else {
                Utils.showToast('Fehler beim Löschen des Services', 'error');
            }
        } catch (error) {
            Utils.showToast('Netzwerkfehler beim Löschen', 'error');
        }
    }

    showHostModal(host = null) {
        const isEdit = !!host;
        const categories = this.dashboardData.categories;
        
        const modalHTML = `
            <div id="hostModal" class="modal" style="display: flex;">
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 class="modal-title">${isEdit ? 'Host bearbeiten' : 'Host hinzufügen'}</h3>
                        <button class="modal-close" onclick="dashboard.closeAllModals()">×</button>
                    </div>
                    <div class="modal-body">
                        <form id="hostForm">
                            <div class="form-group">
                                <label class="form-label">Hostname</label>
                                <input type="text" class="form-input" name="hostname" value="${host?.hostname || ''}" ${isEdit ? 'readonly' : ''} required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Beschreibung</label>
                                <input type="text" class="form-input" name="description" value="${host?.description || ''}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">IP-Adresse</label>
                                <input type="text" class="form-input" name="host" value="${host?.host || ''}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Kategorie</label>
                                <select class="form-input" name="category_id" required>
                                    ${categories.map(cat => 
                                        `<option value="${cat.id}" ${host?.category_id === cat.id ? 'selected' : ''}>${cat.name}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">
                                    <input type="checkbox" name="shared" ${host?.shared ? 'checked' : ''}> Shared Server
                                </label>
                            </div>
                            <div class="form-group">
                                <label class="form-label">
                                    <input type="checkbox" name="ssh" ${host?.access?.ssh ? 'checked' : ''}> SSH aktiviert
                                </label>
                            </div>
                            <div class="form-group">
                                <label class="form-label">SSH Benutzer</label>
                                <input type="text" class="form-input" name="ssh_user" value="${host?.access?.ssh_user || 'root'}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Notizen</label>
                                <textarea class="form-input" name="notes" rows="3">${host?.notes || ''}</textarea>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="dashboard.closeAllModals()">Abbrechen</button>
                        <button class="btn btn-primary" onclick="dashboard.saveHost(${isEdit})">${isEdit ? 'Aktualisieren' : 'Hinzufügen'}</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    showServiceModal(service = null) {
        const isEdit = !!service;
        const hosts = this.dashboardData.servers;
        const categories = this.dashboardData.service_categories;
        
        const modalHTML = `
            <div id="serviceModal" class="modal" style="display: flex;">
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 class="modal-title">${isEdit ? 'Service bearbeiten' : 'Service hinzufügen'}</h3>
                        <button class="modal-close" onclick="dashboard.closeAllModals()">×</button>
                    </div>
                    <div class="modal-body">
                        <form id="serviceForm">
                            <div class="form-group">
                                <label class="form-label">Service Name</label>
                                <input type="text" class="form-input" name="name" value="${service?.name || ''}" ${isEdit ? 'readonly' : ''} required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Beschreibung</label>
                                <input type="text" class="form-input" name="description" value="${service?.description || ''}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Host</label>
                                <select class="form-input" name="hostname" required>
                                    ${hosts.map(host => 
                                        `<option value="${host.hostname}" ${service?.hostname === host.hostname ? 'selected' : ''}>${host.hostname}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Kategorie</label>
                                <select class="form-input" name="category" required>
                                    ${categories.map(cat => 
                                        `<option value="${cat.id}" ${service?.category === cat.id ? 'selected' : ''}>${cat.icon} ${cat.name}</option>`
                                    ).join('')}
                                </select>
                            </div>
                            <div class="form-group">
                                <label class="form-label">URL (extern)</label>
                                <input type="url" class="form-input" name="url" value="${service?.url || ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Interne URL</label>
                                <input type="text" class="form-input" name="internal_url" value="${service?.internal_url || ''}">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Port</label>
                                <input type="number" class="form-input" name="port" value="${service?.port || ''}" min="1" max="65535">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Tags (kommagetrennt)</label>
                                <input type="text" class="form-input" name="tags" value="${service?.tags?.join(', ') || ''}">
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="dashboard.closeAllModals()">Abbrechen</button>
                        <button class="btn btn-primary" onclick="dashboard.saveService(${isEdit})">${isEdit ? 'Aktualisieren' : 'Hinzufügen'}</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
    }

    showCategoriesModal() {
        const categories = this.dashboardData.service_categories;
        
        const modalHTML = `
            <div id="categoriesModal" class="modal" style="display: flex;">
                <div class="modal-container" style="max-width: 800px;">
                    <div class="modal-header">
                        <h3 class="modal-title">Service-Kategorien verwalten</h3>
                        <button class="modal-close" onclick="dashboard.closeAllModals()">×</button>
                    </div>
                    <div class="modal-body">
                        <div class="management-actions" style="margin-bottom: 1rem;">
                            <button class="btn btn-primary" onclick="dashboard.showAddCategoryModal()">+ Kategorie hinzufügen</button>
                        </div>
                        <div id="categoriesList" class="categories-list">
                            ${categories.map(cat => `
                                <div class="category-item" data-category-id="${cat.id}" draggable="true">
                                    <div class="category-drag-handle">⋮⋮</div>
                                    <div class="category-icon" style="color: ${cat.color}">${cat.icon}</div>
                                    <div class="category-info">
                                        <div class="category-name">${cat.name}</div>
                                        <div class="category-description">${cat.description}</div>
                                    </div>
                                    <div class="category-actions">
                                        <button class="action-btn" onclick="dashboard.editCategory('${cat.id}')">✏️</button>
                                        <button class="action-btn" onclick="dashboard.deleteCategory('${cat.id}')">🗑️</button>
                                    </div>
                                </div>
                            `).join('')}
                        </div>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="dashboard.closeAllModals()">Schließen</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        this.initializeDragAndDrop();
    }

    async saveHost(isEdit) {
        const form = document.getElementById('hostForm');
        const formData = new FormData(form);
        
        const hostData = {
            hostname: formData.get('hostname'),
            description: formData.get('description'),
            host: formData.get('host'),
            category_id: formData.get('category_id'),
            shared: formData.has('shared'),
            access: {
                ssh: formData.has('ssh'),
                ssh_user: formData.get('ssh_user') || 'root'
            },
            notes: formData.get('notes') || ''
        };

        try {
            const url = isEdit ? `/api/servers/${hostData.hostname}` : '/api/servers';
            const method = isEdit ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(hostData)
            });

            if (response.ok) {
                Utils.showToast(`Host erfolgreich ${isEdit ? 'aktualisiert' : 'hinzugefügt'}`, 'success');
                this.closeAllModals();
                await this.loadDashboardData();
                this.renderHosts();
            } else {
                const error = await response.json();
                Utils.showToast(error.detail || 'Fehler beim Speichern', 'error');
            }
        } catch (error) {
            Utils.showToast('Netzwerkfehler beim Speichern', 'error');
        }
    }

    async saveService(isEdit) {
        const form = document.getElementById('serviceForm');
        const formData = new FormData(form);
        
        const serviceData = {
            name: formData.get('name'),
            description: formData.get('description'),
            hostname: formData.get('hostname'),
            category: formData.get('category'),
            url: formData.get('url') || null,
            internal_url: formData.get('internal_url') || null,
            port: formData.get('port') ? parseInt(formData.get('port')) : null,
            tags: formData.get('tags') ? formData.get('tags').split(',').map(t => t.trim()).filter(t => t) : []
        };

        try {
            const url = isEdit ? `/api/services/${serviceData.name}` : '/api/services';
            const method = isEdit ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(serviceData)
            });

            if (response.ok) {
                Utils.showToast(`Service erfolgreich ${isEdit ? 'aktualisiert' : 'hinzugefügt'}`, 'success');
                this.closeAllModals();
                await this.loadDashboardData();
                this.renderServices();
            } else {
                const error = await response.json();
                Utils.showToast(error.detail || 'Fehler beim Speichern', 'error');
            }
        } catch (error) {
            Utils.showToast('Netzwerkfehler beim Speichern', 'error');
        }
    }

    initializeDragAndDrop() {
        const categoriesList = document.getElementById('categoriesList');
        if (!categoriesList) return;

        categoriesList.addEventListener('dragstart', (e) => {
            if (e.target.classList.contains('category-item')) {
                this.draggedCategory = e.target;
                e.target.style.opacity = '0.5';
            }
        });

        categoriesList.addEventListener('dragend', (e) => {
            if (e.target.classList.contains('category-item')) {
                e.target.style.opacity = '1';
                this.draggedCategory = null;
            }
        });

        categoriesList.addEventListener('dragover', (e) => {
            e.preventDefault();
        });

        categoriesList.addEventListener('drop', (e) => {
            e.preventDefault();
            if (this.draggedCategory && e.target.closest('.category-item')) {
                const targetCategory = e.target.closest('.category-item');
                if (targetCategory !== this.draggedCategory) {
                    const rect = targetCategory.getBoundingClientRect();
                    const midpoint = rect.top + rect.height / 2;
                    
                    if (e.clientY < midpoint) {
                        categoriesList.insertBefore(this.draggedCategory, targetCategory);
                    } else {
                        categoriesList.insertBefore(this.draggedCategory, targetCategory.nextSibling);
                    }
                    
                    this.saveCategoryOrder();
                }
            }
        });
    }

    async saveCategoryOrder() {
        const categoryItems = document.querySelectorAll('.category-item');
        const order = Array.from(categoryItems).map(item => item.dataset.categoryId);

        try {
            const response = await fetch('/api/service-categories/reorder', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(order)
            });

            if (response.ok) {
                Utils.showToast('Kategorien-Reihenfolge gespeichert', 'success');
                await this.loadDashboardData();
            } else {
                Utils.showToast('Fehler beim Speichern der Reihenfolge', 'error');
            }
        } catch (error) {
            Utils.showToast('Netzwerkfehler beim Speichern', 'error');
        }
    }

    showAddCategoryModal() {
        this.showCategoryModal();
    }

    editCategory(categoryId) {
        const category = this.dashboardData.service_categories.find(c => c.id === categoryId);
        if (category) {
            this.showCategoryModal(category);
        }
    }

    async deleteCategory(categoryId) {
        if (!confirm(`Kategorie wirklich löschen? Services in dieser Kategorie werden unkategorisiert.`)) return;

        try {
            const response = await fetch(`/api/service-categories/${categoryId}`, {
                method: 'DELETE'
            });

            if (response.ok) {
                Utils.showToast('Kategorie erfolgreich gelöscht', 'success');
                await this.loadDashboardData();
                this.renderServices();
                // Refresh categories modal if open
                if (document.getElementById('categoriesModal')) {
                    this.closeAllModals();
                    this.showCategoriesModal();
                }
            } else {
                Utils.showToast('Fehler beim Löschen der Kategorie', 'error');
            }
        } catch (error) {
            Utils.showToast('Netzwerkfehler beim Löschen', 'error');
        }
    }

    showCategoryModal(category = null) {
        const isEdit = !!category;
        
        const modalHTML = `
            <div id="categoryModal" class="modal" style="display: flex;">
                <div class="modal-container">
                    <div class="modal-header">
                        <h3 class="modal-title">${isEdit ? 'Kategorie bearbeiten' : 'Kategorie hinzufügen'}</h3>
                        <button class="modal-close" onclick="dashboard.closeAllModals()">×</button>
                    </div>
                    <div class="modal-body">
                        <form id="categoryForm">
                            <div class="form-group">
                                <label class="form-label">Kategorie-ID</label>
                                <input type="text" class="form-input" name="id" value="${category?.id || ''}" ${isEdit ? 'readonly' : ''} required pattern="[a-z0-9_-]+" title="Nur Kleinbuchstaben, Zahlen, _ und - erlaubt">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Name</label>
                                <input type="text" class="form-input" name="name" value="${category?.name || ''}" required>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Beschreibung</label>
                                <textarea class="form-input" name="description" rows="2">${category?.description || ''}</textarea>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Icon (Emoji)</label>
                                <input type="text" class="form-input" name="icon" value="${category?.icon || '📦'}" maxlength="2">
                            </div>
                            <div class="form-group">
                                <label class="form-label">Farbe</label>
                                <div class="color-input-group">
                                    <input type="color" class="form-input color-picker" name="color" value="${category?.color || '#3498db'}">
                                    <input type="text" class="form-input color-text" name="color_text" value="${category?.color || '#3498db'}" pattern="#[0-9a-fA-F]{6}">
                                </div>
                            </div>
                            <div class="form-group">
                                <label class="form-label">Reihenfolge</label>
                                <input type="number" class="form-input" name="order" value="${category?.order || 1}" min="1" required>
                            </div>
                        </form>
                    </div>
                    <div class="modal-footer">
                        <button class="btn btn-secondary" onclick="dashboard.closeAllModals()">Abbrechen</button>
                        <button class="btn btn-primary" onclick="dashboard.saveCategory(${isEdit})">${isEdit ? 'Aktualisieren' : 'Hinzufügen'}</button>
                    </div>
                </div>
            </div>
        `;
        
        document.body.insertAdjacentHTML('beforeend', modalHTML);
        
        // Sync color picker and text input
        const colorPicker = document.querySelector('input[name="color"]');
        const colorText = document.querySelector('input[name="color_text"]');
        
        colorPicker.addEventListener('input', (e) => {
            colorText.value = e.target.value;
        });
        
        colorText.addEventListener('input', (e) => {
            if (/^#[0-9a-fA-F]{6}$/i.test(e.target.value)) {
                colorPicker.value = e.target.value;
            }
        });
    }

    async saveCategory(isEdit) {
        const form = document.getElementById('categoryForm');
        const formData = new FormData(form);
        
        const categoryData = {
            id: formData.get('id'),
            name: formData.get('name'),
            description: formData.get('description') || '',
            icon: formData.get('icon') || '📦',
            color: formData.get('color'),
            order: parseInt(formData.get('order')) || 1
        };

        try {
            const url = isEdit ? `/api/service-categories/${categoryData.id}` : '/api/service-categories';
            const method = isEdit ? 'PUT' : 'POST';
            
            const response = await fetch(url, {
                method: method,
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(categoryData)
            });

            if (response.ok) {
                Utils.showToast(`Kategorie erfolgreich ${isEdit ? 'aktualisiert' : 'hinzugefügt'}`, 'success');
                this.closeAllModals();
                await this.loadDashboardData();
                this.renderServices();
                // Refresh categories modal if it was open
                setTimeout(() => this.showCategoriesModal(), 100);
            } else {
                const error = await response.json();
                Utils.showToast(error.detail || 'Fehler beim Speichern', 'error');
            }
        } catch (error) {
            Utils.showToast('Netzwerkfehler beim Speichern', 'error');
        }
    }

    closeAllModals() {
        document.querySelectorAll('.modal').forEach(modal => {
            modal.remove();
        });
        
        if (document.getElementById('terminalModal').style.display === 'flex') {
            window.sshTerminal.closeTerminal();
        }
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