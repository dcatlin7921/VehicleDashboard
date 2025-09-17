# Fleet Snapshot Dashboard

A portable, single-file HTML dashboard for small fleet management (≤50 assets). Built for nightly SQL snapshots with optional live preview capabilities.

## Features

- **Zero Configuration**: Works across dev/test/prod with no code changes
- **Portable**: Single HTML file with external CSS/JS - no build process required
- **Real-time KPIs**: Fleet size, miles, utilization, maintenance status, faults
- **Six Tabs**: Overview, Miles, Maintenance, Faults, Assets, Admin
- **Sticky Filters**: Agency/Pool, Class, Active/Inactive, Search VIN/Name
- **Live Preview**: Refresh button for ad-hoc data updates (non-persistent)
- **Admin Settings**: Configurable thresholds, FY start, odometer precedence

## Quick Start

1. **Copy Files**: Place `index.html`, `styles.css`, `app.js`, and `config.json` in your web directory
2. **Configure**: Update `config.json` with your API endpoint
3. **Deploy**: Serve via any web server (Apache, Nginx, IIS, etc.)

## Configuration

### Environment Setup

Copy `config.json.sample` to `config.json` and customize:

```json
{
  "API_BASE": "https://your-api-server.com",
  "ENVIRONMENT": "production"
}
```

### API Requirements

The dashboard expects these REST endpoints:

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/api/info` | GET | System info and data freshness |
| `/api/kpis` | GET | Key performance indicators |
| `/api/miles/monthly` | GET | Monthly mileage data |
| `/api/ytd` | GET | Year-to-date and fiscal year miles |
| `/api/faults/activeSummary` | GET | Active fault summary |
| `/api/maintenance/due` | GET | Due/overdue maintenance |
| `/api/assets` | GET | Asset directory |
| `/api/admin/config` | GET/POST | Admin configuration |
| `/api/refresh-now` | POST | Live preview refresh |

## API Response Formats

### /api/info
```json
{
  "last_snapshot_utc": "2024-09-15T02:30:00Z",
  "fleet_size": 25
}
```

### /api/kpis
```json
{
  "mtd_miles": 15420,
  "ytd_miles": 142380,
  "fytd_miles": 89420,
  "active_assets_7d": 18,
  "utilization_pct_7d": 72.0,
  "avg_mi_asset_day_7d": 12.5,
  "faults_active_vehicle": 3,
  "faults_active_telematics": 1,
  "maint_overdue": 0,
  "maint_due_soon": 2
}
```

### /api/assets
```json
[
  {
    "device_id": "DEV001",
    "device_name": "Vehicle-001",
    "vin": "1HGBH41JXMN109186",
    "latest_odo_miles": 47878,
    "miles_7d": 347,
    "faults_active": 1,
    "maint_status": "OK"
  }
]
```

## Database Schema

The dashboard expects a SQL Server database with these tables:

### Core Tables
- `devices` - Vehicle/asset information
- `odometer_snapshots` - Daily odometer readings
- `fault_events` - Fault codes and events
- `maintenance_intervals` - Service schedules
- `maintenance_events` - Service history
- `config` - System configuration

### Views/Stored Procedures
- `v_odometer_snapshots` - Enhanced odometer data
- `sp_miles_monthly` - Monthly mileage calculations
- `sp_ytd_fytd` - Year calculations
- `sp_faults_active_summary` - Active fault summary
- `sp_maintenance_due` - Due maintenance items
- `sp_assets_overview` - Asset summary
- `sp_info` - System information
- `sp_kpis` - KPI calculations

## Security

- **Frontend**: No secrets stored in HTML/JS
- **Backend**: Windows Integrated/AAD authentication
- **Admin routes**: Require FleetAdmin group membership
- **Database**: Least-privilege access with separate ETL credentials

## Deployment

### Development
```bash
# Simple HTTP server
python -m http.server 8000
# or
npx http-server
```

### Production
- Copy files to web server directory
- Configure reverse proxy for API endpoints
- Set up SSL/TLS certificates
- Configure authentication as needed

### Docker (Optional)
```dockerfile
FROM nginx:alpine
COPY . /usr/share/nginx/html
EXPOSE 80
```

## Customization

### Styling
Edit `styles.css` to match your brand colors and preferences.

### Additional Features
The modular JavaScript structure makes it easy to add:
- New chart types
- Additional filters
- Custom KPIs
- Export functionality

## Browser Support

- Chrome 80+
- Firefox 75+
- Safari 13+
- Edge 80+

## Troubleshooting

### Common Issues

**Dashboard shows no data**
- Check browser console for API errors
- Verify `config.json` API_BASE is correct
- Ensure API endpoints return valid JSON

**Charts not rendering**
- Check for Chart.js loading errors
- Verify canvas elements exist in DOM

**Admin settings not saving**
- Verify user has FleetAdmin permissions
- Check network tab for POST errors

### Debug Mode
Enable debug in `config.json`:
```json
{
  "DEBUG": true
}
```

## Support

For technical issues or feature requests, contact your IT department with:
- Browser version and console errors
- API endpoint responses
- Network request logs

## License

Internal use only - provided as-is for fleet management purposes.
