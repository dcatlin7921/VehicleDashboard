// Fleet Dashboard JavaScript
class FleetDashboard {
    constructor() {
        this.apiBase = '';
        this.config = {};
        this.data = {};
        this.charts = {};
        this.currentTab = 'overview';
        this.filters = {
            agency: '',
            class: '',
            status: '',
            search: ''
        };
        this.pastedMockData = null;
        
        this.init();
    }

    async init() {
        try {
            await this.loadConfig();
            this.setupEventListeners();
            this.loadViewSettings();
            const dataLoaded = await this.loadData();
            if (dataLoaded) {
                this.renderDashboard();
            }
        } catch (error) {
            console.error('Failed to initialize dashboard:', error);
            this.showError('Failed to load dashboard configuration');
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

        // Filters
        document.getElementById('filterAgency').addEventListener('change', (e) => {
            this.filters.agency = e.target.value;
            this.applyFilters();
        });
        document.getElementById('filterClass').addEventListener('change', (e) => {
            this.filters.class = e.target.value;
            this.applyFilters();
        });
        document.getElementById('filterStatus').addEventListener('change', (e) => {
            this.filters.status = e.target.value;
            this.applyFilters();
        });
        document.getElementById('filterSearch').addEventListener('input', (e) => {
            this.filters.search = e.target.value.toLowerCase();
            this.applyFilters();
        });

        // Refresh button
        document.getElementById('refreshBtn').addEventListener('click', () => this.refreshData());

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

        // Mock data buttons
        document.getElementById('generateSchemaBtn').addEventListener('click', () => this.generateMockSchema());
        document.getElementById('loadMockDataBtn').addEventListener('click', () => this.loadPastedMockData());

    }

    async loadData() {
        // --- START: New logic for pasted mock data ---
        if (this.pastedMockData) {
            console.log("Loading from pasted mock data.");
            this.data = {
                info: this.pastedMockData.info || {},
                kpis: this.pastedMockData.kpis || {},
                assets: this.pastedMockData.assets || [],
                maintenance: this.pastedMockData.maintenance || [],
                faults: this.pastedMockData.faults || [],
                miles: this.pastedMockData.miles || []
            };
            // Do not reset this.pastedMockData here, allow multiple re-renders
            // from the same pasted data until it's cleared or a full refresh happens.
            await this.loadAdminConfig(); // Still fetch this live or from fixture
            return true; // Exit early
        }
        // --- END: New logic ---

        try {
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
            return true;
        } catch (error) {
            console.error('Failed to load data:', error);
            this.showError('Failed to load fleet data');
            return false;
        }
    }

    async loadAdminConfig() {
        try {
            const config = await this.apiCall('/api/admin/config');
            if (config) {
                this.populateAdminForm(config);
            }
        } catch (error) {
            console.warn('Could not load admin config:', error);
        }
    }

    async apiCall(endpoint) {
        const url = this.apiBase + endpoint;
        const r = await fetch(url);
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        return r.json();
    }


    renderDashboard() {
        this.updateKPIs();
        this.updateFreshness();
        this.renderCurrentTab();
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
        if (this.data.info.last_snapshot_utc) {
            const date = new Date(this.data.info.last_snapshot_utc);
            lastUpdate.textContent = `Last updated: ${date.toLocaleString()} UTC`;
        } else {
            lastUpdate.textContent = 'No data available';
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

        const dailyMiles = this.data.kpis.daily_miles_60d || [];
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

        const movers = this.data.kpis.top_movers_mtd || [];

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

        const compliance = this.data.kpis.compliance || {};

        const items = [
            { label: 'Overdue maintenance', value: this.data.kpis.maint_overdue || 0, status: (this.data.kpis.maint_overdue > 0) ? 'overdue' : 'ok' },
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

        const monthlyMiles = this.data.miles.filter(m => m.month === '2024-07'); // Example month, will be dynamic
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

        const trend = this.data.kpis.monthly_fleet_miles_12m || [];
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
        const overdue = this.data.maintenance.filter(m => m.status === 'OVERDUE').length;
        const dueSoon = this.data.maintenance.filter(m => m.status === 'DUE_SOON').length;
        const upcoming = this.data.maintenance.filter(m => m.status === 'UPCOMING').length;

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

        const summary = this.data.faults.reduce((acc, fault) => {
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

        const topFaults = this.data.kpis.top_recurring_faults || [];
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

        // In a real app, you'd fetch this data. We'll simulate it for now.
        const [miles, faults, services] = await Promise.all([
            this.apiCall(`/api/miles/asset/${assetId}?months=12`),
            this.apiCall(`/api/faults/history/${assetId}`),
            this.apiCall(`/api/maintenance/asset/${assetId}`)
        ]);

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

    generateMockSchema() {
        const schema = {
            info: { last_snapshot_utc: new Date().toISOString(), fleet_size: 0 },
            kpis: { mtd_miles: 0, ytd_miles: 0, fytd_miles: 0, active_assets_7d: 0, utilization_pct_7d: 0, avg_mi_asset_day_7d: 0, faults_active_vehicle: 0, faults_active_telematics: 0, maint_overdue: 0, maint_due_soon: 0 },
            assets: [{ device_id: 'b1', device_name: 'Vehicle-01', vin: 'VIN01', latest_odo_miles: 10000, miles_7d: 150, faults_active: 0, maint_status: 'OK' }],
            maintenance: [{ device_id: 'b1', service_type: 'Oil Change', last_service_date: '2025-01-01', last_service_odo: 5000, miles_to_due: 4850, days_to_due: 165, status: 'OK' }],
            faults: [{ device_id: 'b2', device_name: 'Vehicle-02', code: 'P0300', description: 'Random Misfire', severity: 'Medium', last_seen_utc: new Date().toISOString(), is_active: true }],
            miles: [{ device_id: 'b1', device_name: 'Vehicle-01', month: '2025-08', start_miles: 9000, end_miles: 9500, miles_driven: 500, dq_flag: 'OK' }]
        };
        const schemaString = JSON.stringify(schema, null, 2);
        document.getElementById('mockDataInput').value = schemaString;
        alert('Blank schema generated in the text box.');
    }

    loadPastedMockData() {
        const jsonText = document.getElementById('mockDataInput').value;
        if (!jsonText) {
            alert('Mock data text box is empty.');
            return;
        }
        try {
            this.pastedMockData = JSON.parse(jsonText);
            // We must reload and re-render everything
            this.loadData().then(() => this.renderDashboard());
            alert('Pasted mock data loaded successfully!');
        } catch (error) {
            console.error('Invalid JSON pasted:', error);
            alert(`Failed to parse mock data. Please check if it's valid JSON. Error: ${error.message}` );
            this.pastedMockData = null; // Clear invalid data
        }
    }

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
            alert('Settings saved successfully');
        } catch (error) {
            console.error('Failed to save settings:', error);
            alert('Failed to save settings');
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
            if (settings.filters) {
                this.filters = settings.filters;
                this.applyFilterValues();
            }
        }
    }

    applyFilterValues() {
        document.getElementById('filterAgency').value = this.filters.agency;
        document.getElementById('filterClass').value = this.filters.class;
        document.getElementById('filterStatus').value = this.filters.status;
        document.getElementById('filterSearch').value = this.filters.search;
    }

    applyFilters() {
        this.renderCurrentTab();
        this.saveViewSettings();
    }

    async refreshData() {
        const btn = document.getElementById('refreshBtn');
        btn.disabled = true;
        btn.textContent = '🔄 Refreshing...';

        try {
            await this.apiCall('/api/refresh-now', { method: 'POST' });
            await this.loadData();
            this.renderDashboard();
        } catch (error) {
            console.error('Failed to refresh data:', error);
            this.showError('Failed to refresh data');
        } finally {
            btn.disabled = false;
            btn.textContent = '🔄 Refresh';
        }
    }

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
        // Simple error display - could be enhanced with a toast/notification system
        alert(message);
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
