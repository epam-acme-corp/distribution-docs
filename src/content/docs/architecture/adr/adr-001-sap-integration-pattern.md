---
title: "ADR-001: SAP ECC Integration Pattern"
---


# ADR-001: SAP ECC Integration Pattern — SOAP Middleware vs. REST Adapter

**Status:** Accepted (approximately 18 months ago)

**Decision Date:** Mid-2023

**Stakeholders:** WMS Team Lead, Platform Team Lead, SAP Team representative, Architecture Review Board

## Context

Acme Distribution's Warehouse Management System (WMS) needs to exchange data with SAP ECC for master data synchronization (products, customers, pricing) and transactional postings (goods receipts, goods issues, inventory adjustments). SAP ECC communicates natively via IDocs (Intermediate Documents), BAPIs (Business Application Programming Interfaces), and RFC (Remote Function Call) connections.

At the same time, the newer internal services — Route Optimization (Python/Flask), Fleet Management (Java/Spring Boot), and IoT Tracking Platform (Node.js) — communicate exclusively via REST/JSON. These services need access to SAP-sourced data (inventory levels, product details, customer information) but cannot consume SOAP/WCF or SAP-native protocols directly.

Two options were evaluated to address this integration gap:

### Option 1: Maintain SOAP Middleware + Add REST Facade

Keep the existing ERP Integration Layer (.NET/WCF) as the primary SAP integration point. Build a REST facade layer on top of the WMS that exposes commonly needed SAP-sourced data as REST/JSON endpoints. The REST facade would be maintained by the WMS team and incrementally expanded as new REST consumers come online.

### Option 2: Build Native REST Adapter in SAP PI

Extend SAP PI (Process Integration) middleware to expose SAP data directly as REST endpoints, bypassing the ERP Integration Layer for REST consumers. This would allow newer services to call SAP data directly via REST without going through the WMS.

## Decision

**We will maintain the existing SOAP/WCF middleware (ERP Integration Layer) as the primary SAP integration point and build a REST facade layer on top of the WMS.**

Specific decisions:

1. The ERP Integration Layer continues to handle all SAP ↔ WMS communication via SOAP/WCF through SAP PI middleware
2. The WMS team builds REST endpoints incrementally, exposing commonly needed SAP-sourced data (inventory, product master, customer master, order and shipment operations) as REST/JSON
3. Newer services (Route Optimization, Fleet Management, IoT Platform) consume these REST endpoints instead of calling WMS WCF services directly
4. We do **not** attempt to build REST endpoints directly in SAP PI

### Rationale

- The SAP team does not have capacity to build and maintain custom REST adapters in SAP PI. SAP PI's REST adapter capability has known limitations with complex payloads and error handling.
- The WMS team has deep expertise in the ERP Integration Layer and can control the REST facade rollout without depending on the SAP team's schedule.
- A REST facade on the WMS allows us to add business logic (caching, data transformation, aggregation) that would be difficult to implement in SAP PI.
- This approach is incremental — we can add REST endpoints as needed without disrupting existing SOAP consumers.

## Consequences

### Positive

- **No SAP customization required:** Avoids adding complexity to SAP ECC or SAP PI, which are managed by a separate corporate team with limited availability
- **Leverages existing expertise:** The WMS team already maintains the ERP Integration Layer and understands the SAP data model
- **Clean API for newer services:** The REST facade provides a modern, well-documented API surface for Python, Java, and Node.js consumers
- **Incremental rollout:** REST endpoints can be added based on consumer demand without a large upfront investment

### Negative

- **Dual integration stack:** The WMS team now owns both the legacy WCF services and the new REST facade, increasing maintenance burden
- **Data freshness dependency:** REST facade data freshness depends on the SOAP synchronization latency between SAP and the WMS. During peak periods, this can introduce a 15–30 minute lag.
- **WMS as a bottleneck:** All SAP-sourced data for internal consumers flows through the WMS, making it a single point of access. If the WMS is down, REST consumers also lose access to SAP data.
- **Temporary complexity:** During the transition period, some consumers use SOAP and others use REST, leading to two sets of client libraries and integration tests

### Risks

- If SAP ECC is ever upgraded to S/4HANA, the entire IDoc/BAPI integration approach will need to be revisited. S/4HANA has native OData REST APIs that could make the ERP Integration Layer and REST facade redundant.
- If the WMS .NET 8 migration changes the service architecture significantly, the REST facade may need to be rebuilt.

## Related

- [Architecture Overview](../overview.md) — overall system integration context
- [System Landscape](../../technical/system-landscape.md) — ERP Integration Layer system details
- [WMS Deep-Dive](../../technical/wms.md) — WMS WCF service inventory and REST facade status
