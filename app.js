// Fleet Dashboard JavaScript
class FleetDashboard {
    constructor() {
        this.apiBase = '';
        this.config = {};
        this.data = {};
        this.charts = {};
        this.currentTab = 'overview';
        // Strict mock mode (session-only). Defaults OFF on refresh.
        this.mockMode = false;
        this.mockData = null;
        this.connectionStatus = 'connecting'; // connecting, online, offline, mock
        this._bannerTimeoutId = null; // timer for auto-hiding status banner
        
        this.init();
    }

    async init() {
        this.updateConnectionStatus('connecting');
        try {
            await this.loadConfig();
            this.setupEventListeners();
            this.loadViewSettings();
            const dataLoaded = await this.loadData();
            if (dataLoaded) {
                this.renderDashboard();
            } else {
                // Data load failed, dashboard will not render, status is already 'offline'
                console.warn('Dashboard initialization skipped due to data load failure.');
            }
        } catch (error) {
            console.error('Failed to initialize dashboard:', error);
            this.showError('Failed to load dashboard configuration');
            this.updateConnectionStatus('offline');
        }
    }

    async loadConfig() {
        try {
            let response = await fetch('config.json');
            if (!response.ok) throw new Error(`HTTP ${response.status}`);
            this.config = await response.json();
        } catch (primaryError) {
            console.warn('config.json load failed, trying config.json.sample', primaryError);
            try {
                const response2 = await fetch('config.json.sample');
                if (!response2.ok) throw new Error(`HTTP ${response2.status}`);
                this.config = await response2.json();
            } catch (error) {
                console.warn('Could not load config.json.sample, using defaults', error);
                this.config = {};
            }
        }
        this.apiBase = this.config.API_BASE || '';
    }

    setupEventListeners() {
        // Tab navigation
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.addEventListener('click', (e) => this.switchTab(e.target.dataset.tab));
        });


        // Header refresh button removed. Guard in case element exists in future.
        const headerRefreshBtn = document.getElementById('refreshBtn');
        if (headerRefreshBtn) {
            headerRefreshBtn.addEventListener('click', () => this.refreshData());
        }

        // Admin form
        document.getElementById('adminForm').addEventListener('submit', (e) => {
            e.preventDefault();
            this.saveAdminSettings();
        });

        // Modal close
        document.querySelector('.close').addEventListener('click', () => {
            document.getElementById('assetModal').style.display = 'none';
        });

        window.addEventListener('click', (e) => {
            const modal = document.getElementById('assetModal');
            if (e.target === modal) {
                modal.style.display = 'none';
            }
        });

        // Mock mode controls (Admin pane)
        const mockToggle = document.getElementById('mockModeToggle');
        const mockFile = document.getElementById('mockFileInput');
        const copySchemaBtn = document.getElementById('copyMockSchemaBtn');
        if (mockToggle) {
            mockToggle.addEventListener('change', async (e) => {
                const on = e.target.checked;
                if (on) {
                    if (!this.mockData) {
                        this.notify('warn', 'Please upload a mock data JSON file to enable Mock Mode.');
                        e.target.checked = false;
                        this.mockMode = false;
                        return;
                    }
                    this.mockMode = true;
                    await this.loadData();
                    this.renderDashboard();
                } else {
                    this.mockMode = false;
                    this.mockData = null; // clear session mock data when turning OFF
                    await this.loadData();
                    this.renderDashboard();
                }
            });
        }
        if (mockFile) {
            mockFile.addEventListener('change', async (e) => {
                const file = e.target.files && e.target.files[0];
                if (!file) return;
                try {
                    const text = await file.text();
                    const json = JSON.parse(text);
                    const { valid, errors } = this.validateMockData(json);
                    if (!valid) {
                        console.error('Mock data validation failed:', errors);
                        this.notify('error', 'Mock data invalid. Fix the JSON to match production schema.\n' + errors.join('\n'));
                        this.mockData = null;
                        if (mockToggle) mockToggle.checked = false;
                        this.mockMode = false;
                        return;
                    }
                    this.mockData = json;
                    if (mockToggle) mockToggle.checked = true;
                    this.mockMode = true;
                    await this.loadData();
                    this.renderDashboard();
                    this.notify('success', 'Mock data loaded. Mock Mode is ON for this session.');
                } catch (err) {
                    console.error('Failed to parse uploaded mock JSON:', err);
                    this.notify('error', 'Failed to parse uploaded JSON: ' + err.message);
                    this.mockData = null;
                    if (mockToggle) mockToggle.checked = false;
                    this.mockMode = false;
                }
            });
        }

        if (copySchemaBtn) {
            copySchemaBtn.addEventListener('click', async () => {
                try {
                    const sample = this.buildSampleMockSchema();
                    const text = JSON.stringify(sample, null, 2);
                    if (navigator.clipboard && navigator.clipboard.writeText) {
                        await navigator.clipboard.writeText(text);
                    } else {
                        // Fallback for environments without Clipboard API
                        const ta = document.createElement('textarea');
                        ta.value = text;
                        document.body.appendChild(ta);
                        ta.select();
                        document.execCommand('copy');
                        document.body.removeChild(ta);
                    }
                    this.notify('success', 'Sample mock schema copied to clipboard.');
                } catch (err) {
                    console.error('Failed to copy sample schema:', err);
                    this.notify('error', 'Failed to copy to clipboard: ' + err.message);
                }
            });
        }

    }

    async loadData() {
        // Strict mock mode: use uploaded JSON only when toggle is ON
        if (this.mockMode && this.mockData) {
            this.updateConnectionStatus('mock');
            this.data = this.mockData;
            await this.loadAdminConfig();
            return true;
        }

        try {
            this.updateConnectionStatus('connecting');
            const [info, kpis, assets, maintenance, faults, miles] = await Promise.all([
                this.apiCall('/api/info'),
                this.apiCall('/api/kpis'),
                this.apiCall('/api/assets'),
                this.apiCall('/api/maintenance/due'),
                this.apiCall('/api/faults/activeSummary'),
                this.apiCall('/api/miles/monthly?months=12')
            ]);

            this.data = {
                info: info || {},
                kpis: kpis || {},
                assets: assets || [],
                maintenance: maintenance || [],
                faults: faults || [],
                miles: miles || []
            };

            await this.loadAdminConfig();
            this.updateConnectionStatus('online');
            return true;
        } catch (error) {
            console.error('Failed to load data:', error);
            this.showError('Failed to load fleet data');
            this.updateConnectionStatus('offline');
            return false;
        }
    }

    async loadAdminConfig() {
        // In mock mode, avoid calling live API. Use admin from mock JSON if provided; otherwise leave current form values.
        if (this.connectionStatus === 'mock') {
            const mockAdmin = (this.mockData && this.mockData.admin) ? this.mockData.admin : null;
            if (mockAdmin) this.populateAdminForm(mockAdmin);
            return;
        }

        try {
            const config = await this.apiCall('/api/admin/config');
            if (config) {
                this.populateAdminForm(config);
            }
        } catch (error) {
            console.warn('Could not load admin config:', error);
        }
    }

    async apiCall(endpoint, options = {}) {
        const url = this.apiBase + endpoint;
        const r = await fetch(url, options);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }


    renderDashboard() {
        this.updateKPIs();
        this.updateFreshness();
        this.renderCurrentTab();
    }

    updateConnectionStatus(status) {
        this.connectionStatus = status;
        const statusIndicator = document.getElementById('connectionStatus');
        if (statusIndicator) {
            statusIndicator.className = 'status-indicator ' + status;
            statusIndicator.textContent = status.charAt(0).toUpperCase() + status.slice(1);
        }
    }

    updateKPIs() {
        const k = this.data.kpis;
        this.updateKPI('fleetSize', k.fleet_size || 0);
        this.updateKPI('mtdMiles', this.formatNumber(k.mtd_miles || 0));
        this.updateKPI('ytdMiles', this.formatNumber(k.ytd_miles || 0));
        this.updateKPI('fytdMiles', this.formatNumber(k.fytd_miles || 0));
        this.updateKPI('activeAssets7d', k.active_assets_7d || 0);
        this.updateKPI('utilizationPct7d', this.formatPercent(k.utilization_pct_7d || 0));
        this.updateKPI('avgMiAssetDay7d', this.formatNumber(k.avg_mi_asset_day_7d || 0, 1));
        this.updateKPI('maintOverdue', k.maint_overdue || 0);
        this.updateKPI('maintDueSoon', k.maint_due_soon || 0);
        this.updateKPI('faultsVehicle', k.faults_active_vehicle || 0);
        this.updateKPI('faultsTelematics', k.faults_active_telematics || 0);
    }

    updateKPI(id, value) {
        const element = document.getElementById(id);
        if (element) {
            element.textContent = value;
            if (id === 'maintOverdue' && value > 0) {
                element.classList.add('overdue');
            }
        }
    }

    updateFreshness() {
        const lastUpdate = document.getElementById('lastUpdate');
        if (!lastUpdate) return;
        if (this.connectionStatus === 'online' && this.data.info && this.data.info.last_snapshot_utc) {
            const date = new Date(this.data.info.last_snapshot_utc);
            lastUpdate.textContent = `Last datapull: ${date.toLocaleString()} UTC`;
        } else {
            lastUpdate.textContent = '';
        }
    }

    switchTab(tabName) {
        // Update tab buttons
        document.querySelectorAll('.tab-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tab === tabName);
        });

        // Update tab panels
        document.querySelectorAll('.tab-panel').forEach(panel => {
            panel.classList.toggle('active', panel.id === tabName);
        });

        this.currentTab = tabName;
        this.renderCurrentTab();
        this.saveViewSettings();
    }

    renderCurrentTab() {
        switch (this.currentTab) {
            case 'overview':
                this.renderOverview();
                break;
            case 'miles':
                this.renderMiles();
                break;
            case 'maintenance':
                this.renderMaintenance();
                break;
            case 'faults':
                this.renderFaults();
                break;
            case 'assets':
                this.renderAssets();
                break;
            case 'admin':
                this.renderAdmin();
                break;
        }
    }

    renderOverview() {
        this.renderDailyMilesChart();
        this.renderTopMovers();
        this.renderCompliance();
    }

    renderDailyMilesChart() {
        const ctx = document.getElementById('dailyMilesChart');
        if (!ctx) return;

        const dailyMiles = this.data.kpis?.daily_miles_60d || [];
        const labels = dailyMiles.map(d => new Date(d.date).toLocaleDateString());
        const data = dailyMiles.map(d => d.miles);


        if (this.charts.dailyMiles) {
            this.charts.dailyMiles.destroy();
        }

        this.charts.dailyMiles = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Daily Miles',
                    data: data,
                    borderColor: '#3498db',
                    backgroundColor: 'rgba(52, 152, 219, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                },
                scales: {
                    y: {
                        beginAtZero: true
                    }
                }
            }
        });
    }

    renderTopMovers() {
        const container = document.getElementById('topMoversList');
        if (!container) return;

        const movers = this.data.kpis?.top_movers_mtd || [];

        if (movers.length === 0) {
            container.innerHTML = '<p>No mileage data for the current period.</p>';
            return;
        }

        container.innerHTML = movers.map(mover => `
            <div class="mover-item">
                <strong>${mover.asset_name}</strong>
                <span>${this.formatNumber(mover.miles)} mi</span>
            </div>
        `).join('');
    }

    renderCompliance() {
        const container = document.getElementById('complianceItems');
        if (!container) return;

        const compliance = this.data.kpis?.compliance || {};
        const kpis = this.data.kpis || {};

        const items = [
            { label: 'Overdue maintenance', value: kpis.maint_overdue || 0, status: (kpis.maint_overdue > 0) ? 'overdue' : 'ok' },
            { label: 'Missing start/end snapshots', value: compliance.missing_snapshots || 0, status: (compliance.missing_snapshots > 0) ? 'warning' : 'ok' },
            { label: 'Device swaps since FY start', value: compliance.device_swaps_fy || 0, status: (compliance.device_swaps_fy > 5) ? 'warning' : 'ok' }
        ];

        container.innerHTML = items.map(item => `
            <div class="compliance-item ${item.status}">
                <span>${item.label}</span>
                <strong>${item.value}</strong>
            </div>
        `).join('');
    }

    renderMiles() {
        this.renderMonthlyMilesChart();
        this.renderFleetMilesTrendChart();
        this.renderMilesTable();
    }

    renderMonthlyMilesChart() {
        const ctx = document.getElementById('monthlyMilesChart');
        if (!ctx) return;

        const monthlyMiles = this.data.miles?.filter(m => m.month === '2024-07') || []; // Example month, will be dynamic
        const labels = monthlyMiles.map(m => m.asset_name);
        const data = monthlyMiles.map(m => m.miles);

        if (this.charts.monthlyMiles) {
            this.charts.monthlyMiles.destroy();
        }

        this.charts.monthlyMiles = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Miles',
                    data: data,
                    backgroundColor: '#3498db'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    renderFleetMilesTrendChart() {
        const ctx = document.getElementById('fleetMilesTrendChart');
        if (!ctx) return;

        const trend = this.data.kpis?.monthly_fleet_miles_12m || [];
        const labels = trend.map(m => m.month);
        const data = trend.map(m => m.miles);

        if (this.charts.fleetMilesTrend) {
            this.charts.fleetMilesTrend.destroy();
        }

        this.charts.fleetMilesTrend = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Fleet Miles',
                    data: data,
                    borderColor: '#27ae60',
                    backgroundColor: 'rgba(39, 174, 96, 0.1)',
                    tension: 0.4,
                    fill: true
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    renderMilesTable() {
        const tbody = document.querySelector('#milesTable tbody');
        if (!tbody) return;

        const data = this.data.miles || [];

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No mileage data available.</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.asset_name}</td>
                <td>${row.month}</td>
                <td>${this.formatNumber(row.start_odo)}</td>
                <td>${this.formatNumber(row.end_odo)}</td>
                <td>${this.formatNumber(row.miles)}</td>
                <td><span class="dq-${row.quality}">${row.quality}</span></td>
            </tr>
        `).join('');
    }

    renderMaintenance() {
        this.updateMaintenanceKPIs();
        this.renderMaintenanceTable();
    }

    updateMaintenanceKPIs() {
        const maintenanceData = this.data.maintenance || [];
        const overdue = maintenanceData.filter(m => m.status === 'OVERDUE').length;
        const dueSoon = maintenanceData.filter(m => m.status === 'DUE_SOON').length;
        const upcoming = maintenanceData.filter(m => m.status === 'UPCOMING').length;

        document.getElementById('maintOverdueTile').textContent = overdue;
        document.getElementById('maintDueSoonTile').textContent = dueSoon;
        document.getElementById('maintUpcomingTile').textContent = upcoming;
    }

    renderMaintenanceTable() {
        const tbody = document.querySelector('#maintenanceTable tbody');
        if (!tbody) return;

        const data = this.data.maintenance || [];

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="7">No maintenance data available.</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.asset_name}</td>
                <td>${row.service_type}</td>
                <td>${row.last_service_date}</td>
                <td>${this.formatNumber(row.last_service_odo)}</td>
                <td>${this.formatNumber(row.miles_to_due)}</td>
                <td>${row.days_to_due}</td>
                <td><span class="status-badge status-${row.status.toLowerCase()}">${row.status}</span></td>
            </tr>
        `).join('');
    }

    renderFaults() {
        this.renderFaultsTable();
        this.renderFaultsCharts();
    }

    renderFaultsTable() {
        const tbody = document.querySelector('#faultsTable tbody');
        if (!tbody) return;

        const data = this.data.faults || [];

        if (data.length === 0) {
            tbody.innerHTML = '<tr><td colspan="6">No active faults.</td></tr>';
            return;
        }

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.asset_name}</td>
                <td>${row.code}</td>
                <td>${row.description}</td>
                <td><span class="severity-${row.severity.toLowerCase()}">${row.severity}</span></td>
                <td>${new Date(row.last_seen_utc).toLocaleString()}</td>
                <td>${row.is_active ? 'Yes' : 'No'}</td>
            </tr>
        `).join('');
    }

    renderFaultsCharts() {
        this.renderFaultsSeverityChart();
        this.renderTopFaultsChart();
    }

    renderFaultsSeverityChart() {
        const ctx = document.getElementById('faultsSeverityChart');
        if (!ctx) return;

        const faultsData = this.data.faults || [];
        const summary = faultsData.reduce((acc, fault) => {
            acc[fault.severity] = (acc[fault.severity] || 0) + 1;
            return acc;
        }, {});

        const labels = Object.keys(summary);
        const data = Object.values(summary);

        if (this.charts.faultsSeverity) {
            this.charts.faultsSeverity.destroy();
        }

        this.charts.faultsSeverity = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: labels,
                datasets: [{
                    data: data,
                    backgroundColor: ['#e74c3c', '#f39c12', '#95a5a6'] // Adjust colors as needed
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        position: 'bottom'
                    }
                }
            }
        });
    }

    renderTopFaultsChart() {
        const ctx = document.getElementById('topFaultsChart');
        if (!ctx) return;

        const topFaults = this.data.kpis?.top_recurring_faults || [];
        const labels = topFaults.map(f => f.code);
        const data = topFaults.map(f => f.count);

        if (this.charts.topFaults) {
            this.charts.topFaults.destroy();
        }

        this.charts.topFaults = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Occurrences',
                    data: data,
                    backgroundColor: '#3498db'
                }]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: {
                        display: false
                    }
                }
            }
        });
    }

    renderAssets() {
        const container = document.getElementById('assetsContainer');
        if (!container) return;

        const assets = this.data.assets || [];

        if (assets.length === 0) {
            container.innerHTML = '<p>No assets found.</p>';
            return;
        }

        container.innerHTML = assets.map(asset => `
            <div class="asset-card" onclick="dashboard.showAssetDetails('${asset.id}')">
                <h4>${asset.name}</h4>
                <div class="asset-info">
                    <span>VIN: ${asset.vin}</span>
                    <span>Odometer: ${this.formatNumber(asset.last_known_odo)} mi</span>
                    <span>7-day miles: ${this.formatNumber(asset.miles_7d)} mi</span>
                    <span>Active faults: ${asset.active_faults}</span>
                    <span>Maintenance: <span class="status-badge status-${asset.maint_status.toLowerCase()}">${asset.maint_status}</span></span>
                </div>
            </div>
        `).join('');
    }

    async showAssetDetails(assetId) {
        const modal = document.getElementById('assetModal');
        const title = document.getElementById('assetModalTitle');
        const content = document.getElementById('assetModalContent');

        const asset = this.data.assets.find(a => a.id === assetId);
        if (!asset) return;

        title.textContent = `${asset.name} Details`;
        content.innerHTML = `Loading details...`;
        modal.style.display = 'block';

        let miles, faults, services;
        if (this.connectionStatus === 'mock') {
            // Use only provided mock dataset; no synthetic data
            const assetName = asset.name;
            miles = (this.data.miles || []).filter(m => m.asset_name === assetName);
            faults = (this.data.faults || []).filter(f => f.asset_name === assetName);
            services = (this.data.maintenance || []).filter(m => m.asset_name === assetName);
        } else {
            // Live mode: fetch from API
            [miles, faults, services] = await Promise.all([
                this.apiCall(`/api/miles/asset/${assetId}?months=12`),
                this.apiCall(`/api/faults/history/${assetId}`),
                this.apiCall(`/api/maintenance/asset/${assetId}`)
            ]);
        }

        content.innerHTML = `
            <h3>12-Month Miles Chart</h3>
            <canvas id="assetMilesChart" width="400" height="200"></canvas>
            <h3>Fault History</h3>
            ${this.renderAssetFaults(faults)}
            <h3>Upcoming Services</h3>
            ${this.renderAssetServices(services)}
        `;

        // Render mini chart
        setTimeout(() => {
            const ctx = document.getElementById('assetMilesChart');
            if (ctx) {
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: miles.map(m => m.month),
                        datasets: [{
                            label: 'Monthly Miles',
                            data: miles.map(m => m.miles),
                            borderColor: '#3498db',
                            backgroundColor: 'rgba(52, 152, 219, 0.1)',
                            tension: 0.4,
                            fill: true
                        }]
                    },
                    options: {
                        responsive: true,
                        maintainAspectRatio: false
                    }
                });
            }
        }, 100);
    }

    // Removed generateMockSchema and pasted mock data loader (strict file-based mock mode only)

    renderAdmin() {
        // Admin form is populated in loadAdminConfig
    }

    renderAssetFaults(faults) {
        if (!faults || faults.length === 0) {
            return '<p>No fault history available.</p>';
        }
        return `
            <ul>
                ${faults.map(f => `<li>${f.code}: ${f.description} (${new Date(f.last_seen_utc).toLocaleDateString()})</li>`).join('')}
            </ul>
        `;
    }

    renderAssetServices(services) {
        if (!services || services.length === 0) {
            return '<p>No upcoming services.</p>';
        }
        return `
            <ul>
                ${services.map(s => `<li>${s.service_type} - Due in ${s.miles_to_due} miles or ${s.days_to_due} days</li>`).join('')}
            </ul>
        `;
    }

    populateAdminForm(config) {
        document.getElementById('fyStartMonth').value = config.fy_start_month || 7;
        document.getElementById('dueSoonMiles').value = config.due_soon_miles || 500;
        document.getElementById('dueSoonDays').value = config.due_soon_days || 15;
        document.getElementById('utilizationThreshold').value = config.utilization_threshold || 1;
        document.getElementById('odometerPrecedence').value = config.odometer_precedence || '';
    }

    async saveAdminSettings() {
        const settings = {
            fy_start_month: parseInt(document.getElementById('fyStartMonth').value),
            due_soon_miles: parseInt(document.getElementById('dueSoonMiles').value),
            due_soon_days: parseInt(document.getElementById('dueSoonDays').value),
            utilization_threshold: parseFloat(document.getElementById('utilizationThreshold').value),
            odometer_precedence: document.getElementById('odometerPrecedence').value
        };

        try {
            await fetch(this.apiBase + '/api/admin/config', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify(settings)
            });
            this.notify('success', 'Settings saved successfully');
        } catch (error) {
            console.error('Failed to save settings:', error);
            this.notify('error', 'Failed to save settings');
        }
    }

    saveViewSettings() {
        const settings = {
            currentTab: this.currentTab,
            filters: this.filters,
        };
        localStorage.setItem('fleetDashboard_viewSettings', JSON.stringify(settings));
    }

    loadViewSettings() {
        const saved = localStorage.getItem('fleetDashboard_viewSettings');
        if (saved) {
            const settings = JSON.parse(saved);
            if (settings.currentTab) {
                this.switchTab(settings.currentTab);
            }
        }
    }


    async refreshData() {
        try {
            if (this.connectionStatus !== 'mock') {
                await this.apiCall('/api/refresh-now', { method: 'POST' });
            }
            await this.loadData();
            this.renderDashboard();
        } catch (error) {
            console.error('Failed to refresh data:', error);
            this.showError('Failed to refresh data');
        }
    }

    // Strict validator for uploaded mock JSON to match production fields used by UI
    validateMockData(payload) {
        const errors = [];
        const isObject = (v) => v && typeof v === 'object' && !Array.isArray(v);
        const isArray = Array.isArray;

        if (!isObject(payload)) {
            return { valid: false, errors: ['Root must be an object'] };
        }

        // info
        if (!isObject(payload.info)) errors.push('Missing object: info');
        // kpis
        if (!isObject(payload.kpis)) errors.push('Missing object: kpis');

        // assets
        if (!isArray(payload.assets)) errors.push('Missing array: assets');
        else {
            payload.assets.forEach((a, i) => {
                const req = ['id','name','vin','last_known_odo','miles_7d','active_faults','maint_status'];
                req.forEach(k => { if (a[k] === undefined) errors.push(`assets[${i}].${k} is required`); });
            });
        }

        // maintenance
        if (!isArray(payload.maintenance)) errors.push('Missing array: maintenance');
        // faults
        if (!isArray(payload.faults)) errors.push('Missing array: faults');
        // miles
        if (!isArray(payload.miles)) errors.push('Missing array: miles');

        return { valid: errors.length === 0, errors };
    }

    // Build a sample mock schema object matching production fields used by the UI
    buildSampleMockSchema() {
        const nowIso = new Date().toISOString();
        return {
            info: { last_snapshot_utc: nowIso },
            kpis: {
                fleet_size: 2,
                mtd_miles: 1200,
                ytd_miles: 15400,
                fytd_miles: 9000,
                active_assets_7d: 2,
                utilization_pct_7d: 65.2,
                avg_mi_asset_day_7d: 14.3,
                faults_active_vehicle: 1,
                faults_active_telematics: 0,
                maint_overdue: 0,
                maint_due_soon: 1,
                daily_miles_60d: [],
                monthly_fleet_miles_12m: [],
                top_recurring_faults: [],
                compliance: { missing_snapshots: 0, device_swaps_fy: 0 }
            },
            assets: [
                { id: 'a1', name: 'Vehicle-01', vin: 'VIN01', last_known_odo: 15000, miles_7d: 320, active_faults: 1, maint_status: 'OK' },
                { id: 'a2', name: 'Vehicle-02', vin: 'VIN02', last_known_odo: 7400, miles_7d: 120, active_faults: 0, maint_status: 'DUE_SOON' }
            ],
            maintenance: [
                { asset_name: 'Vehicle-02', service_type: 'Oil Change', last_service_date: '2025-08-01', last_service_odo: 5000, miles_to_due: 200, days_to_due: 10, status: 'DUE_SOON' }
            ],
            faults: [
                { asset_name: 'Vehicle-01', code: 'P0300', description: 'Random Misfire Detected', severity: 'High', last_seen_utc: nowIso, is_active: true }
            ],
            miles: [
                { asset_name: 'Vehicle-01', month: '2025-08', start_odo: 14000, end_odo: 15000, miles: 1000, quality: 'OK' },
                { asset_name: 'Vehicle-02', month: '2025-08', start_odo: 7000, end_odo: 7400, miles: 400, quality: 'OK' }
            ],
            admin: {
                fy_start_month: 7,
                due_soon_miles: 500,
                due_soon_days: 15,
                utilization_threshold: 1,
                odometer_precedence: 'Engine,Transmission,ABS'
            }
        };
    }

    // Removed built-in default mock dataset

    formatNumber(num, decimals = 0) {
        if (num === null || num === undefined) {
            return 'N/A';
        }
        return num.toLocaleString(undefined, {
            minimumFractionDigits: decimals,
            maximumFractionDigits: decimals
        });
    }

    formatPercent(num) {
        return this.formatNumber(num, 1) + '%';
    }

    showError(message) {
        // Route errors through non-blocking banner
        this.notify('error', message);
    }

    // Non-blocking status banner
    notify(type, message, opts = {}) {
        const { autoHide = true, duration = 4000 } = opts;
        const banner = document.getElementById('statusBanner');
        if (!banner) {
            console.warn('Status banner element not found');
            return;
        }
        const valid = new Set(['info', 'success', 'warn', 'error']);
        const variant = valid.has(type) ? type : 'info';
        banner.className = `status-banner status-${variant}`;
        banner.textContent = message;
        banner.style.display = 'block';

        if (this._bannerTimeoutId) {
            clearTimeout(this._bannerTimeoutId);
            this._bannerTimeoutId = null;
        }
        if (autoHide) {
            this._bannerTimeoutId = setTimeout(() => {
                banner.style.display = 'none';
                this._bannerTimeoutId = null;
            }, Math.max(1500, duration));
        }
    }
}

// Initialize dashboard when DOM is loaded
let dashboard;
document.addEventListener('DOMContentLoaded', () => {
    dashboard = new FleetDashboard();
});

// Global functions for onclick handlers
function refreshData() {
    dashboard.refreshData();
}

function saveViewSettings() {
    dashboard.saveViewSettings();
}
