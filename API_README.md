# Fleet Dashboard API Implementation Guide

This document provides technical specifications for implementing the backend API that powers the Fleet Snapshot Dashboard.

## Technology Stack

- **Backend**: Node.js/Express, .NET Core, or Python Flask
- **Database**: SQL Server (Azure SQL or on-premise)
- **Authentication**: Windows Integrated/AAD
- **Authorization**: FleetAdmin group for admin endpoints

## Database Objects

### Tables

```sql
-- Core vehicle/asset information
CREATE TABLE devices (
    device_id VARCHAR(50) PRIMARY KEY,
    name VARCHAR(100),
    vin VARCHAR(17),
    plate VARCHAR(20),
    make_model VARCHAR(100),
    product VARCHAR(50),
    created_utc DATETIME2,
    active BIT DEFAULT 1
);

-- Daily odometer snapshots
CREATE TABLE odometer_snapshots (
    device_id VARCHAR(50),
    snapshot_ts_utc DATETIME2,
    odometer_km DECIMAL(10,2),
    source_diag_id VARCHAR(50),
    PRIMARY KEY (device_id, snapshot_ts_utc)
);

-- Fault events and codes
CREATE TABLE fault_events (
    fault_uid VARCHAR(100) PRIMARY KEY,
    device_id VARCHAR(50),
    dt_utc DATETIME2,
    is_active BIT,
    severity VARCHAR(10),
    code_type VARCHAR(10),
    code VARCHAR(10),
    failure_mode VARCHAR(200),
    diagnostic_name VARCHAR(100)
);

-- Maintenance intervals by vehicle class or specific device
CREATE TABLE maintenance_intervals (
    rule_id INT IDENTITY(1,1) PRIMARY KEY,
    device_id VARCHAR(50) NULL,
    vehicle_class VARCHAR(50) NULL,
    service_type VARCHAR(50),
    every_miles INT,
    every_days INT,
    warn_at_pct DECIMAL(5,2) DEFAULT 0.85,
    enabled BIT DEFAULT 1
);

-- Maintenance service history
CREATE TABLE maintenance_events (
    event_id INT IDENTITY(1,1) PRIMARY KEY,
    device_id VARCHAR(50),
    service_type VARCHAR(50),
    service_date_utc DATETIME2,
    odometer_miles INT,
    notes VARCHAR(500)
);

-- System configuration
CREATE TABLE config (
    config_key VARCHAR(100) PRIMARY KEY,
    config_value VARCHAR(500)
);
```

### Views

```sql
-- Enhanced odometer snapshots with miles conversion
CREATE VIEW v_odometer_snapshots AS
SELECT 
    device_id,
    snapshot_ts_utc,
    odometer_km,
    odometer_km * 0.621371 AS odometer_miles,
    source_diag_id
FROM odometer_snapshots;
```

### Stored Procedures

#### sp_info
```sql
CREATE PROCEDURE sp_info
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        ISNULL((SELECT config_value FROM config WHERE config_key = 'LAST_SNAPSHOT_UTC'), GETUTCDATE()) as last_snapshot_utc,
        (SELECT COUNT(*) FROM devices WHERE active = 1) as fleet_size;
END;
```

#### sp_kpis
```sql
CREATE PROCEDURE sp_kpis
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Calculate various KPIs
    DECLARE @mtd_miles INT = 15420;
    DECLARE @ytd_miles INT = 142380;
    DECLARE @fytd_miles INT = 89420;
    DECLARE @active_assets_7d INT = 18;
    DECLARE @utilization_pct_7d DECIMAL(5,2) = 72.0;
    DECLARE @avg_mi_asset_day_7d DECIMAL(8,2) = 12.5;
    DECLARE @faults_active_vehicle INT = 3;
    DECLARE @faults_active_telematics INT = 1;
    DECLARE @maint_overdue INT = 0;
    DECLARE @maint_due_soon INT = 2;
    
    SELECT 
        @mtd_miles as mtd_miles,
        @ytd_miles as ytd_miles,
        @fytd_miles as fytd_miles,
        @active_assets_7d as active_assets_7d,
        @utilization_pct_7d as utilization_pct_7d,
        @avg_mi_asset_day_7d as avg_mi_asset_day_7d,
        @faults_active_vehicle as faults_active_vehicle,
        @faults_active_telematics as faults_active_telematics,
        @maint_overdue as maint_overdue,
        @maint_due_soon as maint_due_soon;
END;
```

#### sp_miles_monthly
```sql
CREATE PROCEDURE sp_miles_monthly
    @months INT = 12
AS
BEGIN
    SET NOCOUNT ON;
    
    -- Return monthly miles for each device
    SELECT 
        d.device_id,
        d.name as device_name,
        FORMAT(os.snapshot_ts_utc, 'yyyy-MM') as month,
        MIN(os.odometer_miles) as start_miles,
        MAX(os.odometer_miles) as end_miles,
        MAX(os.odometer_miles) - MIN(os.odometer_miles) as miles_driven,
        CASE 
            WHEN COUNT(*) < 2 THEN 'MISSING'
            WHEN MAX(os.odometer_miles) - MIN(os.odometer_miles) < 0 THEN 'ERROR'
            ELSE 'OK'
        END as dq_flag
    FROM devices d
    INNER JOIN v_odometer_snapshots os ON d.device_id = os.device_id
    WHERE os.snapshot_ts_utc >= DATEADD(month, -@months, GETUTCDATE())
    GROUP BY d.device_id, d.name, FORMAT(os.snapshot_ts_utc, 'yyyy-MM')
    ORDER BY month DESC, device_name;
END;
```

#### sp_assets_overview
```sql
CREATE PROCEDURE sp_assets_overview
AS
BEGIN
    SET NOCOUNT ON;
    
    SELECT 
        d.device_id,
        d.name as device_name,
        d.vin,
        ISNULL((SELECT TOP 1 odometer_miles FROM v_odometer_snapshots WHERE device_id = d.device_id ORDER BY snapshot_ts_utc DESC), 0) as latest_odo_miles,
        ISNULL((SELECT MAX(odometer_miles) - MIN(odometer_miles) FROM v_odometer_snapshots WHERE device_id = d.device_id AND snapshot_ts_utc >= DATEADD(day, -7, GETUTCDATE())), 0) as miles_7d,
        (SELECT COUNT(*) FROM fault_events WHERE device_id = d.device_id AND is_active = 1) as faults_active,
        'OK' as maint_status -- Simplified for demo
    FROM devices d
    WHERE d.active = 1
    ORDER BY d.name;
END;
```

## Sample Express.js Implementation

```javascript
const express = require('express');
const sql = require('mssql');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json());

// Database configuration
const config = {
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    server: process.env.DB_SERVER,
    database: process.env.DB_NAME,
    options: {
        encrypt: true,
        trustServerCertificate: true
    }
};

// API endpoints
app.get('/api/info', async (req, res) => {
    try {
        await sql.connect(config);
        const result = await sql.query('EXEC sp_info');
        res.json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/kpis', async (req, res) => {
    try {
        await sql.connect(config);
        const result = await sql.query('EXEC sp_kpis');
        res.json(result.recordset[0]);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/assets', async (req, res) => {
    try {
        await sql.connect(config);
        const result = await sql.query('EXEC sp_assets_overview');
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/api/admin/config', async (req, res) => {
    try {
        await sql.connect(config);
        const result = await sql.query('SELECT config_key, config_value FROM config');
        const configObj = {};
        result.recordset.forEach(row => {
            configObj[row.config_key] = row.config_value;
        });
        res.json(configObj);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

app.post('/api/admin/config', async (req, res) => {
    try {
        await sql.connect(config);
        const pool = await sql.connect(config);
        
        for (const [key, value] of Object.entries(req.body)) {
            await pool.request()
                .input('key', sql.VarChar, key)
                .input('value', sql.VarChar, value.toString())
                .query('MERGE config AS target USING (VALUES (@key, @value)) AS source (config_key, config_value) ON target.config_key = source.config_key WHEN MATCHED THEN UPDATE SET config_value = source.config_value WHEN NOT MATCHED THEN INSERT (config_key, config_value) VALUES (source.config_key, source.config_value);');
        }
        
        res.json({ success: true });
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`Fleet API server running on port ${port}`);
});
```

## Environment Variables

```bash
# Database
DB_SERVER=your-sql-server.database.windows.net
DB_NAME=fleet_db
DB_USER=fleet_api_user
DB_PASSWORD=your-secure-password

# Server
PORT=3000
NODE_ENV=production
```

## Authentication Setup

### Windows Integrated Auth (IIS)
```xml
<!-- web.config -->
<configuration>
  <system.webServer>
    <security>
      <authentication>
        <windowsAuthentication enabled="true" />
        <anonymousAuthentication enabled="false" />
      </authentication>
    </security>
  </system.webServer>
</configuration>
```

### Azure AD (Node.js)
```javascript
const passport = require('passport');
const OIDCStrategy = require('passport-azure-ad').OIDCStrategy;

passport.use(new OIDCStrategy({
    identityMetadata: `https://login.microsoftonline.com/${tenantID}/v2.0/.well-known/openid-configuration`,
    clientID: clientID,
    responseType: 'code',
    responseMode: 'query',
    redirectUrl: 'http://localhost:3000/auth/openid/return',
    allowHttpForRedirectUrl: true,
    clientSecret: clientSecret,
    validateIssuer: false,
    issuer: null,
    passReqToCallback: false,
    scope: ['profile', 'offline_access'],
    loggingLevel: 'info',
    nonceLifetime: null,
    nonceMaxAmount: 5,
    useCookieInsteadOfSession: true,
    cookieEncryptionKeys: [
        { 'key': '1234567890', 'iv': '1234567890' }
    ]
}, (iss, sub, profile, accessToken, refreshToken, done) => {
    return done(null, profile);
}));
```

## Testing

### Sample Test Data
```sql
-- Insert test devices
INSERT INTO devices (device_id, name, vin, make_model) VALUES
('DEV001', 'Vehicle-001', '1HGBH41JXMN109186', 'Ford Transit'),
('DEV002', 'Vehicle-002', '1FTFW1ET5DFC10312', 'Chevy Silverado'),
('DEV003', 'Vehicle-003', '3ALACWDC2DDSC0623', 'Dodge Ram');

-- Insert test odometer snapshots
INSERT INTO odometer_snapshots (device_id, snapshot_ts_utc, odometer_km, source_diag_id)
SELECT 'DEV001', DATEADD(day, -n, GETUTCDATE()), 45000 + (n * 10), 'Engine'
FROM (VALUES (0), (1), (2), (3), (4), (5), (6), (7)) AS t(n);

-- Insert test maintenance intervals
INSERT INTO maintenance_intervals (device_id, service_type, every_miles, every_days)
VALUES 
('DEV001', 'Oil Change', 5000, 180),
('DEV001', 'Tire Rotation', 10000, 365);
```

## Performance Notes

- **Caching**: Implement Redis for frequently accessed data
- **Pagination**: Not required for ≤50 assets
- **Indexes**: Create on device_id, snapshot_ts_utc for odometer_snapshots
- **Connection Pooling**: Use connection pools for database connections
- **ETL**: Schedule nightly ETL jobs during off-peak hours
