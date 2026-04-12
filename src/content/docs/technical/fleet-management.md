---
title: "Fleet Management"
---


# Acme Distribution — Fleet Management

> **Note:** Documentation for this service is being updated as part of the GitHub migration. The README in the `acme-dist-fleet-management` repository exists but is not comprehensive. This document provides the detailed technical reference.

## System Overview

The Fleet Management system handles the operational side of Acme Distribution's delivery fleet — vehicle tracking, maintenance scheduling, fuel management, driver compliance, and reporting. It works closely with the Route Optimisation Service (which plans routes) and the IoT Tracking Platform (which stores historical GPS data).

- **Technology:** Java 11, Spring Boot 2
- **Database:** MySQL 8 (Azure Managed — flexible server, ~200 GB)
- **Deployment:** AKS — 3 replicas, 2 vCPU / 4 GB each
- **Repository:** `acme-dist-fleet-management`
- **CI:** GitHub Actions — Maven build + unit tests + SpotBugs static analysis on push/PR
- **Team:** Fleet/IoT Team (10 developers — shared with IoT Tracking Platform)

## Vehicle Inventory

Acme Distribution operates approximately 1,200 vehicles across all 5 distribution center locations:

| Vehicle Type | Count | Capacity (lbs) | Fuel Type | Primary Use |
|-------------|-------|----------------|-----------|-------------|
| Delivery Van | ~700 | 3,000 | Gasoline | Last-mile B2C delivery |
| Medium-Duty Truck | ~350 | 10,000 | Diesel | B2B warehouse-to-warehouse, large deliveries |
| Refrigerated Unit | ~150 | 5,000 | Diesel | Temperature-controlled food and pharmaceutical delivery |

Vehicle data tracked in the system includes:
- Vehicle type, make, model, year
- Capacity (weight and volume)
- Fuel type (diesel, gasoline)
- Registration details and license plate
- Insurance expiry date
- Current odometer reading (updated from OBD-II telematics)
- Vehicle status: `active`, `in-maintenance`, `out-of-service`, `retired`
- Assigned distribution center (vehicles can be rebalanced seasonally)

Average fleet age is 4.2 years with a 6-year replacement cycle. Vehicle acquisition is managed through a mix of direct purchase and operating leases.

## Maintenance Scheduling

### Preventive Maintenance

Preventive maintenance is scheduled based on mileage intervals and time intervals, whichever threshold is reached first:

- **Mileage-based:** Every 10,000 miles — oil change, filter replacement, tire rotation, brake inspection
- **Time-based:** Every 6 months — comprehensive vehicle inspection including fluids, belts, electrical, and safety equipment
- The system generates upcoming maintenance alerts at 500 miles / 2 weeks before the threshold

### Corrective Maintenance

- Driver-reported issues are logged through the mobile app or dispatch: unusual noise, warning lights, performance issues
- Each report creates a maintenance work order in the Fleet Management system
- Work order lifecycle: `reported` → `scheduled` → `in-progress` → `complete` → `verified`
- Vehicles with open safety-related work orders are automatically set to `out-of-service` until repair is verified

### Maintenance Facilities

- Each distribution center has a basic on-site maintenance facility for routine work (oil changes, tire rotations, brake pad replacement)
- Major repairs (engine work, transmission, body repair) are outsourced to regional partner shops under contract
- Parts inventory is maintained per location for common items (oil, filters, brakes, tires). Major parts are ordered from suppliers with 24–48 hour lead time.

## Fuel Management

- **Fuel cards:** Each vehicle is assigned a WEX fleet fuel card. Transactions are tracked per vehicle with driver identification.
- **Data import:** Fuel transactions are imported nightly via the WEX API. Each transaction includes: date, time, station location, gallons, cost, driver ID, vehicle ID.
- **MPG tracking:** Miles per gallon is calculated per vehicle using odometer readings and fuel transaction data. Actual MPG is compared against expected MPG for each vehicle type.
- **Anomaly detection:** Fuel consumption significantly above expected MPG for the vehicle type triggers an alert for investigation. Possible causes include fuel theft, mechanical issues (engine misfire, dragging brakes), or excessive idling.
  - Current anomaly detection has approximately 15% false positive rate — tuning is ongoing to reduce noise
- **Cost reporting:** Fuel costs are reported per vehicle, per route, per driver, and per client. This data feeds into client billing for 3PL contracts and internal cost allocation for Acme Retail.

## GPS Tracking

All 1,200 vehicles are equipped with OBD-II telematics dongles that provide continuous position tracking:

- **Update frequency:** Every 5 seconds when the vehicle is moving; every 60 seconds when stationary
- **Data path:** OBD-II dongle → cellular (4G LTE) → Fleet Management REST API → MySQL (current position) and IoT Platform InfluxDB (historical positions)
- **Dual storage pattern:**
  - **MySQL:** Stores the current (latest) GPS position per vehicle. Used for real-time queries: "Where is vehicle X right now?"
  - **InfluxDB (via IoT Platform):** Stores the full historical GPS track. Used for analytics: "Show me this vehicle's route for the past week."
- **Geofencing:** Alerts configured for key locations:
  - Warehouse perimeter — arrival and departure notifications for dispatch
  - Customer delivery locations — arrival notification triggers ETA update
  - Unauthorized area alerts (e.g., vehicle leaves expected service area)

## Driver Management

### Driver Profiles

Each driver has a profile in the Fleet Management system that includes:
- Name, employee ID, contact information
- Driver's licence number, licence class (CDL-A, CDL-B, standard), licence expiry date
- Certifications: hazmat endorsement, oversized load certification, defensive driving
- Employment status: active, on-leave, terminated
- Assigned distribution center and default vehicle

### Licence Expiry Tracking

The system tracks licence expiry dates and generates warnings at 90, 60, and 30 days before expiry. Drivers with expired licences are automatically flagged as `not eligible for route assignment` until their licence is renewed.

### Hours-of-Service Compliance

Federal DOT regulations (49 CFR § 395.3) limit driver working hours:
- **11-hour driving limit:** A driver may drive a maximum of 11 hours after 10 consecutive hours off duty
- **14-hour on-duty limit:** A driver may not drive beyond the 14th consecutive hour after coming on duty

The Fleet Management system tracks on-duty and drive time based on GPS data (ignition on/off timestamps) and delivery confirmation timestamps from the Driver App. Compliance is calculated in near real-time and dispatch is alerted when a driver approaches limits.

### Driver Performance Metrics

- **On-time delivery rate:** Percentage of deliveries completed within the customer's requested time window
- **Fuel efficiency:** Actual MPG vs. expected MPG for the driver's assigned vehicle type
- **Idle time:** Time spent with engine running and vehicle stationary (outside of delivery stops)
- **Harsh events:** Harsh braking and rapid acceleration events detected by the OBD-II dongle

## Reporting

Key reports generated by the Fleet Management system:

| Report | Frequency | Audience | Key Metrics |
|--------|-----------|----------|-------------|
| Fleet Utilization | Daily | Operations Manager | % of available fleet on road (target: 85%) |
| Maintenance Cost | Monthly | Finance, Fleet Manager | Cost per vehicle, cost per mile (preventive vs. corrective) |
| Fuel Consumption | Weekly | Fleet Manager | MPG per vehicle, fuel cost trends, anomaly alerts |
| Driver Performance | Weekly | Dispatch Supervisor | On-time rate, fuel efficiency, safety score per driver |
| Vehicle Lifecycle | Quarterly | Finance, Fleet Manager | Acquisition cost, total maintenance cost, projected replacement date |

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/api/vehicles` | GET | List all vehicles with filters (type, status, location) |
| `/api/vehicles/{id}` | GET | Get vehicle details |
| `/api/vehicles/{id}/maintenance` | GET/POST | Maintenance history and create work orders |
| `/api/vehicles/{id}/position` | GET | Current GPS position |
| `/api/drivers` | GET | List all drivers |
| `/api/drivers/{id}/hours` | GET | Hours-of-service summary for a driver |
| `/api/fleet/utilization` | GET | Fleet utilization summary (date param) |
| `/api/fuel/transactions` | GET | Fuel transaction history (date range, vehicle, driver filters) |

All REST endpoints use API key authentication (header: `X-API-Key`). API keys are stored in Azure Key Vault and rotated annually.

## Known Issues

- _"Java 11 is approaching our internal EOL policy. Upgrade to Java 17 is planned but not yet scheduled. The team has been focused on feature work for new 3PL client onboarding."_
- **MySQL replication lag:** Occasional replication lag on the MySQL read replica causes stale vehicle position reads (2–3 seconds behind primary). This is noticeable when dispatch checks vehicle positions in rapid succession.
- **Fuel anomaly detection false positives:** The current threshold-based anomaly detection has approximately 15% false positive rate. The team is evaluating a moving-average approach to reduce false alerts.
- **OBD-II dongle connectivity:** Some older OBD-II dongles (approximately 150 units from the first deployment batch) have intermittent cellular connectivity issues. Replacement with newer hardware is rolling out over the next 6 months.
- **Missing telematics for leased vehicles:** A small number of short-term leased vehicles (~30) do not have OBD-II dongles installed. These vehicles lack GPS tracking and fuel monitoring until dongles are provisioned.

## Related Documentation

- **Architecture context:** See [Architecture Overview](../architecture/overview.md)
- **System landscape:** See [System Landscape](system-landscape.md)
- **Route Optimisation (route planning):** See [Route Optimisation Service](route-optimization.md)
- **IoT Platform (historical GPS data):** See [IoT Tracking Platform](iot-tracking.md)
- **Data architecture:** See [Data Architecture](../data/architecture.md)
