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
        
        this.init();
    }

    async init() {
        try {
            await this.loadConfig();
            this.setupEventListeners();
            this.loadViewSettings();
            await this.loadData();
            this.renderDashboard();
        } catch (error) {
            console.error('Failed to initialize dashboard:', error);
            this.showError('Failed to load dashboard configuration');
        }
    }

    async loadConfig() {
        try {
            const response = await fetch('/config.json');
            this.config = await response.json();
            this.apiBase = this.config.API_BASE || '';
        } catch (error) {
            console.warn('Could not load config.json, using defaults');
            this.config = {};
            this.apiBase = '';
        }
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
    }

    async loadData() {
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
        } catch (error) {
            console.error('Failed to load data:', error);
            this.showError('Failed to load fleet data');
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
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        return await response.json();
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

        // Mock data for 60 days - replace with actual API call
        const labels = [];
        const data = [];
        const today = new Date();
        
        for (let i = 59; i >= 0; i--) {
            const date = new Date(today);
            date.setDate(date.getDate() - i);
            labels.push(date.toLocaleDateString());
            data.push(Math.floor(Math.random() * 500) + 100);
        }

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

        // Mock top 5 movers
        const movers = [
            { name: 'Vehicle-001', miles: 2847 },
            { name: 'Vehicle-015', miles: 2651 },
            { name: 'Vehicle-007', miles: 2432 },
            { name: 'Vehicle-023', miles: 2219 },
            { name: 'Vehicle-012', miles: 1987 }
        ];

        container.innerHTML = movers.map(mover => `
            <div class="mover-item">
                <strong>${mover.name}</strong>
                <span>${this.formatNumber(mover.miles)} mi</span>
            </div>
        `).join('');
    }

    renderCompliance() {
        const container = document.getElementById('complianceItems');
        if (!container) return;

        const items = [
            { label: 'Overdue maintenance', value: this.data.kpis.maint_overdue || 0, status: 'overdue' },
            { label: 'Missing start/end snapshots', value: 0, status: 'ok' },
            { label: 'Device swaps since FY start', value: 2, status: 'warning' }
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

        // Mock data
        const labels = ['V001', 'V002', 'V003', 'V004', 'V005', 'V006', 'V007', 'V008', 'V009', 'V010'];
        const data = labels.map(() => Math.floor(Math.random() * 2000) + 500);

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

        const labels = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
        const data = labels.map(() => Math.floor(Math.random() * 25000) + 15000);

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

        const data = [
            { device: 'Vehicle-001', month: '2024-09', start: 45231, end: 47878, miles: 2647, quality: 'good' },
            { device: 'Vehicle-002', month: '2024-09', start: 38921, end: 41234, miles: 2313, quality: 'good' },
            { device: 'Vehicle-003', month: '2024-09', start: 52341, end: 54876, miles: 2535, quality: 'warning' }
        ];

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.device}</td>
                <td>${row.month}</td>
                <td>${this.formatNumber(row.start)}</td>
                <td>${this.formatNumber(row.end)}</td>
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

        const data = [
            { device: 'Vehicle-001', service: 'Oil Change', lastDate: '2024-08-15', lastOdo: 45000, milesToDue: 500, daysToDue: 15, status: 'DUE_SOON' },
            { device: 'Vehicle-002', service: 'Tire Rotation', lastDate: '2024-07-01', lastOdo: 38000, milesToDue: -200, daysToDue: -5, status: 'OVERDUE' },
            { device: 'Vehicle-003', service: 'Brake Inspection', lastDate: '2024-09-01', lastOdo: 52000, milesToDue: 8000, daysToDue: 180, status: 'UPCOMING' }
        ];

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.device}</td>
                <td>${row.service}</td>
                <td>${row.lastDate}</td>
                <td>${this.formatNumber(row.lastOdo)}</td>
                <td>${this.formatNumber(row.milesToDue)}</td>
                <td>${row.daysToDue}</td>
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

        const data = [
            { device: 'Vehicle-001', code: 'P0420', desc: 'Catalyst System Efficiency Below Threshold', severity: 'HIGH', lastSeen: '2024-09-15', active: true },
            { device: 'Vehicle-002', code: 'P0171', desc: 'System Too Lean', severity: 'MEDIUM', lastSeen: '2024-09-14', active: true },
            { device: 'Vehicle-003', code: 'P0300', desc: 'Random/Multiple Cylinder Misfire', severity: 'HIGH', lastSeen: '2024-09-13', active: false }
        ];

        tbody.innerHTML = data.map(row => `
            <tr>
                <td>${row.device}</td>
                <td>${row.code}</td>
                <td>${row.desc}</td>
                <td><span class="severity-${row.severity.toLowerCase()}">${row.severity}</span></td>
                <td>${row.lastSeen}</td>
                <td>${row.active ? 'Yes' : 'No'}</td>
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

        const data = { HIGH: 3, MEDIUM: 8, LOW: 15 };

        if (this.charts.faultsSeverity) {
            this.charts.faultsSeverity.destroy();
        }

        this.charts.faultsSeverity = new Chart(ctx, {
            type: 'doughnut',
            data: {
                labels: Object.keys(data),
                datasets: [{
                    data: Object.values(data),
                    backgroundColor: ['#e74c3c', '#f39c12', '#95a5a6']
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

        const data = [
            { code: 'P0420', count: 5 },
            { code: 'P0171', count: 3 },
            { code: 'P0300', count: 2 },
            { code: 'P0442', count: 2 },
            { code: 'P0128', count: 1 }
        ];

        if (this.charts.topFaults) {
            this.charts.topFaults.destroy();
        }

        this.charts.topFaults = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: data.map(d => d.code),
                datasets: [{
                    label: 'Occurrences',
                    data: data.map(d => d.count),
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

        const assets = [
            { id: 1, name: 'Vehicle-001', vin: '1HGBH41JXMN109186', odo: 47878, miles7d: 347, faults: 1, maint: 'OK' },
            { id: 2, name: 'Vehicle-002', vin: '1FTFW1ET5DFC10312', odo: 41234, miles7d: 289, faults: 0, maint: 'DUE_SOON' },
            { id: 3, name: 'Vehicle-003', vin: '3ALACWDC2DDSC0623', odo: 54876, miles7d: 412, faults: 2, maint: 'OVERDUE' }
        ];

        container.innerHTML = assets.map(asset => `
            <div class="asset-card" onclick="dashboard.showAssetDetails(${asset.id})">
                <h4>${asset.name}</h4>
                <div class="asset-info">
                    <span>VIN: ${asset.vin}</span>
                    <span>Odometer: ${this.formatNumber(asset.odo)} mi</span>
                    <span>7-day miles: ${this.formatNumber(asset.miles7d)} mi</span>
                    <span>Active faults: ${asset.faults}</span>
                    <span>Maintenance: <span class="status-badge status-${asset.maint.toLowerCase()}">${asset.maint}</span></span>
                </div>
            </div>
        `).join('');
    }

    showAssetDetails(assetId) {
        const modal = document.getElementById('assetModal');
        const title = document.getElementById('assetModalTitle');
        const content = document.getElementById('assetModalContent');

        const asset = { id: assetId, name: `Vehicle-${String(assetId).padStart(3, '0')}` };
        
        title.textContent = `${asset.name} Details`;
        content.innerHTML = `
            <h3>12-Month Miles Chart</h3>
            <canvas id="assetMilesChart" width="400" height="200"></canvas>
            <h3>Fault History</h3>
            <p>No recent faults</p>
            <h3>Upcoming Services</h3>
            <p>Oil change due in 500 miles</p>
        `;

        modal.style.display = 'block';

        // Render mini chart
        setTimeout(() => {
            const ctx = document.getElementById('assetMilesChart');
            if (ctx) {
                new Chart(ctx, {
                    type: 'line',
                    data: {
                        labels: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
                        datasets: [{
                            label: 'Monthly Miles',
                            data: Array(12).fill(0).map(() => Math.floor(Math.random() * 2000) + 1000),
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

    renderAdmin() {
        // Admin form is populated in loadAdminConfig
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
            filters: this.filters
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
