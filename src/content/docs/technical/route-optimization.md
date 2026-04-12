---
title: "Route Optimisation Service"
---


# Acme Distribution — Route Optimisation Service

> **Note:** Documentation for this service is being updated as part of the GitHub migration. The README in the `acme-dist-route-optimization` repository exists but is not comprehensive. This document provides the detailed technical reference.

## System Overview

The Route Optimisation Service plans optimal delivery routes for Acme Distribution's fleet using the Vehicle Routing Problem (VRP) approach. It is one of the "modern" services in the Acme Distribution portfolio, built as a microservice and deployed on Azure Kubernetes Service.

- **Technology:** Python 3.10, Flask web framework
- **Database:** PostgreSQL 14 (Azure Managed — flexible server, ~50 GB)
- **Deployment:** AKS — 3 replicas, 2 vCPU / 4 GB each
- **Repository:** `acme-dist-route-optimization`
- **CI:** GitHub Actions — build + unit tests + flake8 linting on push/PR
- **Team:** Logistics Team (8 developers — shared with Driver Mobile App)
- **Key libraries:** Google OR-Tools (constraint solver), HERE Maps SDK (distance matrices, geocoding, traffic)
- **HERE Maps API:** API key stored in Azure Key Vault, rotated quarterly. Current tier allows 250,000 transactions/month; usage averages ~150,000/month.

## Core Functionality — Vehicle Routing Problem (VRP)

The service solves a Capacitated Vehicle Routing Problem with Time Windows (CVRPTW), which is the mathematical formulation for planning delivery routes that minimize total drive time while respecting multiple constraints.

### Input Data

For each optimization run, the service receives:
- **Delivery addresses:** Geocoded latitude/longitude for each delivery point (geocoding via HERE Maps if coordinates not cached)
- **Time windows:** Customer-requested delivery windows (e.g., 9:00 AM – 12:00 PM, 1:00 PM – 5:00 PM)
- **Vehicle capacity:** Weight and volume limits per vehicle, obtained from Fleet Management
- **Driver hours-of-service:** DOT (Department of Transportation) regulatory limits
- **Vehicle types:** Refrigeration requirements, hazmat certification requirements

### Optimization Objective

Minimize total drive time across all routes while satisfying all constraints. Secondary objective: maximize vehicle load utilization (deliver more per trip).

### Constraints

| Constraint | Limit | Source |
|-----------|-------|--------|
| Maximum drive time per day | 11 hours | DOT regulation (49 CFR § 395.3) |
| Maximum on-duty time per day | 14 hours | DOT regulation (49 CFR § 395.3) |
| Delivery time windows | Customer-specified | Order data from WMS |
| Vehicle weight limit — Van | 3,000 lbs | Fleet Management |
| Vehicle weight limit — Truck | 10,000 lbs | Fleet Management |
| Vehicle weight limit — Refrigerated | 5,000 lbs | Fleet Management |
| Refrigeration requirement | Certain deliveries require refrigerated vehicles | Order data (product attributes) |
| Driver certifications | Hazmat deliveries require certified drivers | Driver profile from Fleet Management |

### Google OR-Tools Implementation

The service uses the `ortools.constraint_solver.routing` module with the CVRPTW model:
- Distance and time matrices are computed from HERE Maps distance matrix API before optimization
- The solver is configured with a time limit (default: 300 seconds) and metaheuristic search strategy (guided local search)
- Typical solve time: 2–5 minutes for a batch of 500 deliveries across 30 vehicles
- For large problem instances (1,000+ deliveries during peak), solve time can reach 10 minutes

## HERE Maps Integration

### Distance Matrix Calculation

Before each optimization run, the service calls the HERE Maps Matrix Routing API to compute drive times between all delivery points plus the warehouse origin. This produces an N×N time matrix used as input to OR-Tools.

### Real-Time Traffic

HERE Traffic API is used for intraday re-optimization to account for current traffic conditions. The nightly batch does not use real-time traffic (routes are planned for the next day).

### ETA Estimation

HERE Maps provides estimated arrival times for each stop based on the optimized route sequence and current or predicted traffic patterns. These ETAs are sent to the Driver App and shared with customers.

### Geocoding

Delivery addresses from WMS orders are geocoded using the HERE Geocoding API. Results are cached in PostgreSQL to avoid redundant API calls — cache hit rate is approximately 85% (many deliveries go to repeat addresses).

## Route Planning Workflow

### Nightly Batch (Primary)

The nightly batch process runs every evening and produces routes for the following day:

1. **8:00 PM** — Route Optimization pulls next-day delivery orders from WMS via REST facade (`GET /api/v1/orders?status=READY_FOR_ROUTE&shipDate={tomorrow}`)
2. **8:05 PM** — Fleet Management queried for available vehicles and drivers for the next day (`GET /api/fleet/utilization?date={tomorrow}`)
3. **8:10 PM** — HERE Maps distance matrix calculated for all delivery points per warehouse region
4. **8:15 PM** — Google OR-Tools VRP solver runs with all constraints loaded
5. **8:20–8:25 PM** — Solution produced: ordered stop sequence per driver, estimated arrival and departure times at each stop
6. **8:30 PM** — Routes stored in PostgreSQL and made available via API
7. **5:00 AM (next day)** — Driver App pulls routes for the day at shift start

### Intraday Dynamic Re-Optimization

Re-optimization is triggered when conditions change during the delivery day:
- New urgent orders added after the nightly batch
- A driver reports a significant delay (e.g., vehicle breakdown, traffic incident)
- A delivery is cancelled or rescheduled

Re-optimization characteristics:
- Runs only for remaining undelivered stops (smaller problem size)
- Uses real-time traffic data from HERE Maps
- Solution typically available in 30–60 seconds
- Drivers are notified of route changes via push notification through the Driver App
- Re-optimization can be triggered manually by dispatch or automatically based on delay thresholds

## API Endpoints

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/routes/optimize` | POST | Trigger route optimization for a given date and warehouse |
| `/routes/{date}/summary` | GET | Get summary of all routes for a given date |
| `/routes/{date}/{driverId}` | GET | Get specific driver's route for a date |
| `/routes/{date}/{driverId}/stops` | GET | Get ordered stop list with ETAs |
| `/routes/reoptimize` | POST | Trigger intraday re-optimization |
| `/health` | GET | Health check endpoint |

### Example Request — `/routes/optimize`

```json
{
  "date": "2024-03-15",
  "warehouseId": "DAL01",
  "options": {
    "maxSolveTimeSeconds": 300,
    "useRealTimeTraffic": false
  }
}
```

### Output Format

For each driver, the optimization produces:
- **Ordered stop sequence** — visit order from warehouse departure to last stop and return
- **Estimated arrival time** at each stop
- **Estimated departure time** from each stop (based on average service time)
- **Turn-by-turn navigation link** — HERE Maps deep link for the Driver App
- **Total distance and drive time** for the full route
- **Vehicle load utilization** — percentage of weight and volume capacity used

## Known Issues

- _"The nightly optimization sometimes produces suboptimal routes for the Los Angeles warehouse due to traffic unpredictability on Southern California freeways. We're considering switching to a 5:00 AM optimization using real-time traffic for the LA region."_
- HERE Maps distance matrix API has occasional timeout issues for large matrices (500+ points). Retry logic is implemented with exponential backoff, but retries can add 2–3 minutes to the optimization pipeline.
- Google OR-Tools solver can take up to 10 minutes for very large problem instances (1,000+ deliveries) during peak season. The team has discussed problem decomposition (splitting by geographic zone before optimization) but hasn't implemented it yet.
- The PostgreSQL database currently does not archive old route data. Routes from more than 6 months ago should be purged or archived to keep query performance stable — this cleanup task is on the backlog.

## Related Documentation

- **Architecture context:** See [Architecture Overview](../architecture/overview.md)
- **System landscape:** See [System Landscape](system-landscape.md)
- **Fleet Management (vehicle data):** See [Fleet Management](fleet-management.md)
- **IoT Platform (GPS tracking):** See [IoT Tracking Platform](iot-tracking.md)
- **Driver Mobile App:** Referenced in context — detailed documentation is not in current scope
