---
title: "Architecture Overview"
---


# Acme Distribution — Architecture Overview

> **Note:** Architecture documentation is being consolidated as part of the GitHub migration. Diagrams from the previous Azure DevOps wiki have been partially migrated. Some may be out of date. Proper architecture diagrams are a future deliverable.

## Current Architecture Overview

Acme Distribution's architecture has evolved organically over the past decade into a **hub-and-spoke pattern** with the Warehouse Management System (WMS) at the center. The WMS is the monolithic hub — all order fulfillment flows through it. Surrounding services (Route Optimization, Fleet Management, IoT Tracking Platform, Driver Mobile App) are loosely coupled and communicate via REST APIs where possible.

The ERP Integration Layer acts as the bridge between two distinct integration paradigms that coexist in the architecture:

- **SOAP/WCF world:** The WMS and ERP Integration Layer communicate via WCF services (SOAP/XML). SAP ECC communicates via IDocs, BAPIs, and RFC calls through SAP PI middleware into the ERP Integration Layer.
- **REST/JSON world:** Newer services (Route Optimization, Fleet Management, IoT Platform) communicate via REST/JSON APIs.

This dual-protocol architecture is the defining characteristic of the Acme Distribution integration landscape and a source of ongoing maintenance overhead (see [ADR-001](adr/ADR-001-sap-integration-pattern.md) for the architectural decision behind this approach).

## Integration Architecture

### SOAP/WCF ↔ REST Impedance Mismatch

The WMS exposes approximately 15 WCF services (SOAP/XML). Newer services need to consume WMS data and operations, but they communicate via REST/JSON. The current integration approach is:

- The **ERP Integration Layer** translates between SAP protocols (IDoc/BAPI/RFC) and WMS WCF services. It is the primary path for SAP ↔ WMS communication.
- A **REST facade** is being built incrementally on top of the WMS (per ADR-001) to expose commonly needed operations as REST endpoints. Priority is on endpoints that Route Optimization and Fleet Management consume.
- Some services still call WMS WCF endpoints directly — the REST facade does not yet cover all operations.

### SAP ECC Integration

- SAP ECC communicates via IDocs (Intermediate Documents) and BAPI (Business Application Programming Interface) calls
- The ERP Integration Layer handles all SAP communication through SAP PI (Process Integration) middleware
- RFC (Remote Function Call) destinations are configured between SAP and the middleware
- Data flows: product master (MATMAS IDoc), customer master (DEBMAS IDoc), ASNs (DESADV IDoc), goods movements (WMMBXY IDoc, BAPI_GOODSMVT_CREATE)

### Internal REST APIs

Route Optimization, Fleet Management, and IoT Platform expose REST APIs and communicate with each other via REST. These services do not use SOAP and interact with the WMS either through the REST facade (where available) or directly via WCF endpoints.

### MQTT for IoT

IoT data flows through a separate channel — the MQTT broker (Mosquitto). This is deliberately separated from the REST/SOAP integration patterns:
- IoT devices publish telemetry to MQTT topics
- The IoT Platform subscribes to MQTT messages, processes them, and stores data in InfluxDB
- Other services (Fleet Management, WMS) query the IoT Platform via REST API for aggregated data

### Integration Flow Summary

The logical integration flow between systems:

- **SAP ECC** ↔ (IDoc/BAPI via SAP PI) ↔ **ERP Integration Layer** ↔ (SOAP/WCF) ↔ **WMS**
- **WMS** ↔ (REST facade, in progress) ↔ **Route Optimization**, **Fleet Management**
- **IoT Devices** → (MQTT) → **IoT Platform** → (REST) → **Fleet Management**, **WMS**
- **Driver App** → (REST) → **Route Optimization**, **WMS**
- **WMS** → (REST webhook) → **Acme Retail** (order status notifications)
- **WMS** → (REST) → **DHL/FedEx** (shipping labels, tracking)

## Deployment Architecture

| System | Deployment Target | Infrastructure | Notes |
|--------|------------------|---------------|-------|
| WMS | On-premises IIS | Windows Server 2016 | Cannot move to cloud until .NET migration complete |
| ERP Integration Layer | On-premises IIS | Windows Server 2016 | Co-located with WMS for latency |
| Route Optimisation Service | Azure Kubernetes Service (AKS) | 3 replicas, 2 vCPU / 4 GB each | Scales for nightly batch route optimization |
| Fleet Management | Azure Kubernetes Service (AKS) | 3 replicas, 2 vCPU / 4 GB each | Handles GPS position ingestion at scale |
| IoT Tracking Platform | Azure Kubernetes Service (AKS) | 3 replicas, 2 vCPU / 8 GB each | Higher memory for MQTT message processing |
| Driver Mobile App | Mobile devices | Android / iOS | SQLite local DB, REST sync to WMS and Route Optimization |
| MQTT Broker (Mosquitto) | Azure VM | Single instance, 4 vCPU / 16 GB | Known single point of failure — HA planned |
| InfluxDB | Azure VM | Single instance, 8 vCPU / 32 GB | Time-series data for IoT |

### Infrastructure Notes

- **Hybrid connectivity:** On-premises WMS and ERP Integration Layer connect to Azure services via site-to-site VPN. Latency is typically 5–15 ms.
- **AKS cluster:** Single AKS cluster in Azure South Central US (Dallas region). Managed node pools with autoscaling enabled.
- **No multi-region:** All services run in a single Azure region. Disaster recovery procedures are documented but have not been tested in over 18 months.
- **On-premises to cloud path:** The WMS and ERP Integration Layer remain on-premises. Cloud migration for these systems is blocked by the .NET Framework 4.6 dependency. The planned .NET 8 migration is a prerequisite for cloud deployment.

## Data Flow — Order Fulfillment

The end-to-end data flow for a typical order passing through the Acme Distribution system:

1. **Order received** — Acme Retail sends an order via REST API (`POST /api/v1/orders`) to the WMS
2. **WMS allocates inventory** — checks stock availability across warehouse locations, reserves inventory, assigns to a warehouse
3. **WMS generates pick wave** — the order is included in the next pick wave based on carrier cutoff time and priority
4. **Pick wave released** — warehouse staff receive pick lists on RF scanners, pull from WMS WCF services
5. **Pick/Pack/Ship** — warehouse staff pick items, pack into cartons (cartonization algorithm selects box size), and prepare for shipment
6. **Shipping label generated** — WMS calls DHL or FedEx API to generate shipping label and tracking number
7. **Route Optimization notified** — WMS notifies Route Optimization Service of new shipments for next-day delivery window
8. **Route Optimization runs** — nightly batch (or intraday for urgent orders) produces optimized routes per driver using Google OR-Tools VRP solver
9. **Driver App receives route** — at shift start, the Driver App pulls the day's route with ordered stops, navigation links (HERE Maps), and delivery details
10. **Delivery executed** — driver delivers packages, captures proof-of-delivery (electronic signature + photo) via the mobile app
11. **Driver App syncs** — delivery confirmation pushed back to WMS and Route Optimization. WMS updates order status.
12. **WMS updates SAP** — goods issue posted to SAP ECC via ERP Integration Layer (BAPI_GOODSMVT_CREATE, movement type 601)
13. **WMS notifies Acme Retail** — order status webhook (`ORDER_SHIPPED`, `ORDER_DELIVERED`) sent to Acme Retail's order management system

## IoT Data Architecture

IoT data flows are deliberately separated from transactional order fulfillment data:

- The MQTT broker receives telemetry from approximately 2,350 devices (warehouse sensors + vehicle GPS trackers + refrigeration monitors)
- The IoT Platform (Node.js) subscribes to MQTT messages, validates and processes them, and writes to InfluxDB
- Time-series data in InfluxDB is used for: temperature monitoring, GPS fleet tracking, humidity monitoring, door sensor tracking, and anomaly detection
- Cross-reference with transactional data happens at the application layer — for example, Fleet Management queries the IoT Platform REST API for vehicle positions, and the WMS queries temperature data for cold-chain compliance reports
- Grafana dashboards provide operational visibility (warehouse conditions, fleet map, cold-chain compliance) but are not integrated into the WMS user interface — they are a separate tool accessed by operations staff

For detailed IoT platform documentation, see [IoT Tracking Platform](../technical/iot-tracking.md).

## Known Architectural Issues

The following architectural concerns are known and tracked by the engineering teams:

- _"The WMS is tightly coupled to SAP ECC — any SAP change requires WMS testing. This has slowed SAP upgrade discussions."_ The coupling is through the ERP Integration Layer, but the WMS business logic has SAP-specific assumptions (movement types, IDoc structures) embedded in its code.
- **Dual SOAP/REST integration** creates maintenance overhead. Every new integration point must decide which protocol to use, and the REST facade does not yet cover all WMS operations. This leads to some services maintaining both SOAP and REST client code.
- **On-premises WMS is a bottleneck** for cloud-native development patterns. Services running on AKS must communicate with the WMS over VPN, which adds latency and a network dependency.
- **Single MQTT broker instance** is a known risk for the IoT data pipeline. If Mosquitto goes down, telemetry data is lost until it is restarted. HA deployment is planned for Q3.
- **No API gateway.** Services communicate directly with each other, making centralized security enforcement, rate limiting, and observability difficult. Each service implements its own authentication and logging.
- **Disaster recovery has not been tested recently.** The Platform team acknowledges this as a risk. DR procedures exist in documentation but the last full DR test was over 18 months ago.

## Related Documentation

- **System inventory:** See [System Landscape](../technical/system-landscape.md) for detailed system and technology inventory
- **Business context:** See [Business Overview](../business/overview.md)
- **SAP integration decision:** See [ADR-001: SAP Integration Pattern](adr/ADR-001-sap-integration-pattern.md)
- **WMS details:** See [WMS Deep-Dive](../technical/wms.md)
- **IoT details:** See [IoT Tracking Platform](../technical/iot-tracking.md)
