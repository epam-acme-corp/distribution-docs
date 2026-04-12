---
title: "IoT Tracking Platform"
---


# Acme Distribution — IoT Tracking Platform

> **Note:** IoT Platform documentation was previously maintained in a Confluence space that was not migrated to GitHub. This documentation is being written fresh as part of the GitHub migration effort.

## System Overview

The IoT Tracking Platform is Acme Distribution's telemetry and sensor data backbone, collecting data from approximately 2,350 devices across all 5 warehouses and the entire delivery fleet. The platform handles temperature monitoring (critical for cold-chain compliance), warehouse environmental sensors, GPS fleet tracking (historical data), and door/access sensors.

- **Technology:** Node.js 18, Express web framework
- **MQTT Broker:** Mosquitto (Eclipse Mosquitto) on Azure VM (single instance, 4 vCPU / 16 GB)
- **Database:** InfluxDB 2 (time-series) on Azure VM (single instance, 8 vCPU / 32 GB)
- **Application Deployment:** AKS — 3 replicas, 2 vCPU / 8 GB each (higher memory allocation for MQTT message processing)
- **Repository:** `acme-dist-iot-platform`
- **CI:** GitHub Actions — build + unit tests + ESLint on push/PR
- **Team:** Fleet/IoT Team (10 developers — shared with Fleet Management)

## Device Inventory

### Warehouse Sensors

| Device Type | Count | Locations | Data Frequency | Purpose |
|------------|-------|-----------|----------------|---------|
| Temperature Sensors | ~500 | All 5 warehouses (100 per warehouse) | Every 60 seconds | Ambient and cold-storage temperature monitoring |
| Humidity Sensors | ~200 | All 5 warehouses (40 per warehouse) | Every 60 seconds | Humidity monitoring for sensitive goods |
| Door Sensors | ~150 | All 5 warehouses (30 per warehouse) | Event-driven (open/close) | Dock door and cold-storage door monitoring |

### Fleet Devices

| Device Type | Count | Purpose | Data Frequency |
|------------|-------|---------|----------------|
| GPS Trackers (OBD-II) | ~1,200 | Vehicle position tracking | Every 5 seconds (moving), 60 seconds (stationary) |
| Refrigeration Temperature Monitors | ~300 | Refrigerated vehicle temperature | Every 30 seconds |

**Total:** approximately 2,350 active devices across all locations and fleet.

## MQTT Topic Structure

The MQTT broker uses a hierarchical topic structure for organizing device telemetry:

```
acme/
├── warehouse/
│   ├── {warehouseId}/
│   │   ├── temp/{sensorId}          # Temperature readings
│   │   ├── humidity/{sensorId}       # Humidity readings
│   │   └── door/{sensorId}           # Door open/close events
│   └── alerts/                       # Warehouse alert broadcasts
├── fleet/
│   ├── {vehicleId}/
│   │   ├── gps                       # GPS position updates
│   │   └── temp                      # Refrigeration temperature
│   └── alerts/                       # Fleet alert broadcasts
└── system/
    ├── heartbeat                     # Device heartbeat messages
    └── config                        # Device configuration updates
```

### Example MQTT Messages

**Temperature reading** (topic: `acme/warehouse/DAL01/temp/TEMP-DAL01-CS03-042`):

```json
{
  "sensorId": "TEMP-DAL01-CS03-042",
  "warehouseId": "DAL01",
  "zone": "COLD-STORAGE-03",
  "temperature": 34.2,
  "unit": "F",
  "timestamp": "2024-03-15T14:30:00Z",
  "batteryLevel": 87
}
```

**GPS position** (topic: `acme/fleet/VAN-0412/gps`):

```json
{
  "vehicleId": "VAN-0412",
  "latitude": 32.7767,
  "longitude": -96.7970,
  "speed": 35.5,
  "heading": 180,
  "odometer": 45230.5,
  "engineOn": true,
  "timestamp": "2024-03-15T14:30:05Z"
}
```

**MQTT QoS levels:**
- Temperature and GPS telemetry: QoS 1 (at least once delivery) — acceptable to receive duplicate messages, which are deduplicated by timestamp
- Door sensors: QoS 2 (exactly once delivery) — security implications require guaranteed delivery without duplicates

## Data Flow Architecture

The end-to-end data flow from device to consumer:

1. **Device** publishes telemetry to the MQTT broker (Mosquitto) via TLS-encrypted MQTT connection (port 8883)
2. **MQTT Broker** receives messages and routes them to all subscribers based on topic
3. **IoT Platform** (3 Node.js instances) subscribes to relevant topics and consumes messages. Subscriber instances use MQTT shared subscriptions to distribute load.
4. **Processing pipeline** on each message:
   - Schema validation (required fields, data types, timestamp freshness)
   - Unit conversion (all temperatures stored in Fahrenheit internally)
   - Alert rule evaluation (temperature excursion, door open duration, device offline)
   - Write to InfluxDB
5. **InfluxDB** stores time-series data with appropriate tags for efficient querying
6. **Grafana** reads from InfluxDB for real-time operational dashboards
7. **REST API** (same Node.js application) exposes query endpoints for other services (Fleet Management, WMS)

## InfluxDB Schema

| Measurement | Tags | Fields | Retention |
|------------|------|--------|-----------|
| `warehouse_temp` | `warehouse_id`, `zone`, `sensor_id` | `temperature` (float), `battery_level` (int) | Raw: 90 days, Downsampled (5-min avg): 2 years |
| `warehouse_humidity` | `warehouse_id`, `zone`, `sensor_id` | `humidity` (float), `battery_level` (int) | Raw: 90 days, Downsampled: 2 years |
| `warehouse_door` | `warehouse_id`, `door_id`, `door_type` | `state` (string: open/closed), `duration_seconds` (int) | Raw: 90 days, Downsampled: 2 years |
| `fleet_position` | `vehicle_id`, `vehicle_type` | `latitude` (float), `longitude` (float), `speed` (float), `heading` (int), `odometer` (float) | Raw: 90 days, Downsampled (1-min): 2 years |
| `fleet_temp` | `vehicle_id` | `temperature` (float), `setpoint` (float) | Raw: 90 days, Downsampled: 2 years |

### Retention Policies

- **Raw data:** 90-day retention at full resolution. Used for troubleshooting, detailed analysis, and compliance audits (FDA cold-chain requirements).
- **Downsampled data:** 2-year retention with aggregated values (5-minute averages for warehouse sensors, 1-minute averages for GPS). Used for trend analysis, reporting, and the Snowflake ETL pipeline.
- InfluxDB continuous queries handle downsampling automatically on a scheduled basis.

### Data Volumes

- Approximately **100 million data points per day** across all measurements
- InfluxDB storage: ~500 GB current, growing at approximately 50 GB/month
- Peak write rate: ~5,000 points/second during business hours (all 5 warehouses and fleet operational)

## Alerting System

| Alert Type | Condition | Severity | Notification Channel | Expected Response |
|-----------|-----------|----------|---------------------|-------------------|
| Temperature excursion (cold storage) | Temp > 40°F or < 28°F for > 5 minutes | Critical | Twilio SMS + PagerDuty | Immediate investigation required |
| Temperature excursion (refrigerated vehicle) | Temp > 40°F for > 10 minutes | Critical | Twilio SMS to driver + dispatch | Driver pulls over, checks refrigeration unit |
| Humidity excursion | Humidity > 80% for > 30 minutes | Warning | Email to warehouse manager | Investigate HVAC system |
| Door open (cold storage) | Door open > 15 minutes | Warning | Twilio SMS to shift supervisor | Close door or investigate reason |
| Door open (after hours) | Any dock door open outside shift hours | High | PagerDuty + SMS to security | Security investigation |
| Device offline | No heartbeat for > 10 minutes | Warning | PagerDuty to IoT team | Check device connectivity |
| GPS signal lost | No GPS update for > 5 minutes (vehicle in motion) | Warning | Notification to dispatch | Contact driver |

### Alert Processing

- Alert rules are evaluated in real-time as MQTT messages are processed by the Node.js application
- Alert state is tracked in-memory with persistence to an InfluxDB `alerts` measurement for history and reporting
- **Escalation:** If a critical alert is not acknowledged within 15 minutes, it escalates to the next management level
- **Twilio SMS:** Alerts sent via Twilio REST API with delivery confirmation tracking. SMS delivery failures are logged and retried.

## REST API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/sensors/{type}/{id}/readings` | GET | Get sensor readings with time range (`from`, `to`, `aggregation` query params) |
| `/sensors/{type}/summary` | GET | Get summary statistics for all sensors of a type |
| `/alerts/active` | GET | Get all currently active alerts |
| `/alerts/history` | GET | Get alert history with filters (type, severity, date range) |
| `/devices/status` | GET | Get device connectivity status (online, offline, battery low) |
| `/fleet/{vehicleId}/track` | GET | Get vehicle GPS track for a time range |
| `/warehouse/{id}/environment` | GET | Get current environmental conditions (temperature, humidity) for a warehouse |
| `/health` | GET | Health check endpoint |

All REST endpoints use API key authentication (header: `X-API-Key`). MQTT connections use TLS client certificates provisioned during device registration.

## Grafana Dashboards

Key operational dashboards available to warehouse managers, fleet operations, and engineering teams via SSO:

- **Warehouse Overview:** Per-warehouse environmental conditions including temperature heatmap, humidity levels, and door status. Device connectivity status panel shows online/offline counts.
- **Cold-Chain Compliance:** Temperature history for all cold-storage zones across warehouses. Excursion event log with duration and root cause annotations. Compliance percentage calculated per zone.
- **Fleet Map:** Real-time vehicle positions plotted on a map (Grafana GeoMap panel). Vehicle status overlay shows active, idle, and in-maintenance vehicles.
- **Refrigeration Compliance:** Refrigerated vehicle temperature history with setpoint comparison. Excursion event tracking per vehicle.
- **IoT Platform Health:** MQTT message throughput, InfluxDB write performance, REST API response times, and device connectivity rates. Used by the engineering team for platform monitoring.

The Grafana instance runs on AKS alongside the IoT Platform application.

## Known Issues

- _"The MQTT broker is a single instance with no HA configuration. This is a known risk. If the Mosquitto instance goes down, we lose telemetry data until it's restarted. Messages published during downtime are lost — QoS 1 does not help if the broker itself is unavailable. HA cluster deployment is planned for Q3."_
- **InfluxDB single instance:** Same HA concern applies to InfluxDB. A single instance failure would result in loss of write capability and query availability until recovery.
- **Grafana dashboard maintenance:** Dashboards were initially built ad-hoc by different team members. Some dashboards are unmaintained and may display stale or broken panels. A dashboard cleanup and standardization effort is planned.
- **Multi-tenancy limitation:** The MQTT topic structure does not support tenant isolation. If 3PL clients ever need isolated telemetry data feeds, the topic structure and access control will need a redesign.
- **Firmware updates:** Device firmware updates are currently performed manually via USB when devices are accessible. Over-the-Air (OTA) update capability is on the product roadmap but not yet implemented.

## Related Documentation

- **Architecture context:** See [Architecture Overview](../architecture/overview.md)
- **System landscape:** See [System Landscape](system-landscape.md)
- **Fleet Management (GPS data consumer):** See [Fleet Management](fleet-management.md)
- **Data architecture (ETL and analytics):** See [Data Architecture](../data/architecture.md)
