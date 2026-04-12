---
title: "WMS Deep-Dive"
---


# Acme Distribution — Warehouse Management System (WMS) Deep-Dive

> **Note:** This documentation is being consolidated as part of the GitHub migration. The original WMS documentation was maintained in an Azure DevOps wiki and has been partially migrated. Some sections may reference ADO build definitions that are no longer active — GitHub Actions CI is now the canonical CI pipeline.

## System Overview

The Warehouse Management System (WMS) is the most critical and complex system in Acme Distribution's technology landscape. It handles all core warehouse operations across 5 regional distribution centers, processing approximately 25,000 orders per day in steady state and up to 80,000 during peak seasons (Black Friday / Holiday).

- **Technology:** .NET Framework 4.6, WCF (Windows Communication Foundation) services
- **Web Server:** IIS on Windows Server 2016
- **Database:** SQL Server 2016 — the largest database in the Acme Distribution landscape (~2 TB per warehouse instance)
- **Deployment:** On-premises at all 5 warehouse locations. Each warehouse has a local WMS instance with a local SQL Server. Transactional replication syncs data to a central SQL Server instance in Dallas for reporting and SAP reconciliation.
- **Team:** WMS Team — 15 developers, based in Dallas, TX
- **Repository:** `acme-dist-wms`
- **CI:** GitHub Actions — build + unit tests on push/PR (`.github/workflows/ci.yml`). No CD pipeline yet — deployment is scripted but manual.

The WMS was originally designed for a single warehouse and has been incrementally expanded to support multi-warehouse operations over the past decade. This heritage is visible in both its architecture and its known issues.

## Warehouse Operations — Detailed Workflow

### Receiving

The receiving process handles inbound goods from suppliers and internal transfers:

- **Purchase Order receipt:** Inbound POs are loaded into the WMS from SAP (via ERP Integration Layer) or directly from 3PL clients
- **ASN matching:** Advanced Shipping Notices from suppliers are matched against expected POs. The ASN provides expected items, quantities, and container information
- **Dock appointment scheduling:** Carriers are assigned dock doors and time slots to manage receiving capacity and avoid congestion. Each warehouse has 8–12 dock doors.
- **Unload and count verification:** Dock staff scan each pallet and case with RF scanners. Scanned quantities are compared against the ASN in real-time.
- **Quality check:** Configurable quality hold rules per product category. Food items require temperature check upon receipt (recorded via IoT temperature sensors at the dock). Electronics require visual inspection for damage.
- **Put-away:** System-directed put-away based on a rules engine that considers velocity classification (ABC), item size, weight, and zone assignment. The WMS suggests the optimal put-away location and the dock worker confirms via RF scanner.
- **Discrepancy handling:** Over-receipts, short-receipts, and damaged goods are recorded and trigger an exception workflow. Discrepancies above a configurable threshold require supervisor approval before put-away.

### Storage

- **Location management:** Each warehouse is divided into zones — bulk storage, pick locations, reserve storage, staging areas, and dock areas. Zones have configurable rules for what product types can be stored.
- **Bin assignment:** ABC velocity classification determines bin location. A items (high velocity, ~20% of SKUs, ~80% of picks) are placed in prime pick locations closest to pack stations. B and C items are in reserve or upper-level storage.
- **Directed put-away:** The WMS suggests optimal put-away locations based on the rules engine. Workers confirm placement via RF scanner. The system prevents put-away to full or incompatible locations.
- **Cycle counting:** Continuous cycle count program replaces annual full physical inventory. High-value/high-velocity items (A class) are counted monthly. Standard items (B class) are counted quarterly. Low-velocity items (C class) are counted semi-annually.
- **Replenishment:** Automatic replenishment triggers when pick location inventory falls below a configured minimum threshold. The system generates replenishment tasks to move stock from reserve to pick locations.
- **Cross-warehouse transfer:** Supported for inventory rebalancing between distribution centers. This process has known edge cases (see Known Issues section).

### Picking

- **Wave planning:** The WMS generates pick waves based on carrier cutoff times, order priority, and warehouse zone. Wave generation runs every 30 minutes during shift hours and can be triggered manually for urgent orders.
- **Pick list generation:** Each wave produces pick lists grouped by zone for efficiency. Pick lists are sent to RF scanners.
- **Pick methods:**
  - **Single-order pick:** For large, multi-line orders — one picker handles one order end-to-end
  - **Batch pick:** Multiple small orders picked simultaneously — picker receives a consolidated pick list and sorts items by order at the pack station
  - **Zone pick:** Items grouped by warehouse zone — each zone has dedicated pickers, and orders are assembled at a consolidation point
- **RF scanner-directed picking:** Pick staff follow scanner prompts: go to location → scan location barcode → scan item barcode → confirm quantity. The scanner validates each step to prevent pick errors.
- **Pick confirmation:** Each line is confirmed in real-time via RF scanner. The WMS updates inventory immediately — reserved quantity decreases, on-hand quantity remains until ship confirm.

### Packing

- **Cartonization:** Algorithm selects optimal box size based on item dimensions, quantity, and weight to minimize shipping costs and dimensional weight charges
- **Pack station workflow:** Scan order → system displays required items and recommended box size → pack items → scan each item barcode for verification → seal carton → print shipping label
- **Pack verification:** Barcode scan of each item at the pack station confirms correct items and quantities. Mismatches trigger an alert.
- **Shipping label printing:** Integrated with DHL and FedEx APIs for real-time label generation. Labels are printed at the pack station on Zebra thermal printers.
- **Packing slip generation:** Customer-facing packing slip with order details, item descriptions, and return instructions included in each shipment

### Shipping

- **Carrier selection:** Rules-based carrier selection considering service level (next-day, 2-day, ground), cost, destination zone, and package dimensions
- **Rate shopping:** The ShippingService queries DHL and FedEx rate APIs and selects the best rate at the required service level
- **BOL generation:** Bill of Lading generated for LTL (Less Than Truckload) shipments with consignee and shipper information
- **Truck loading:** Load sequence optimized for delivery route — last delivery loaded first (LIFO)
- **Manifest creation:** Electronic manifest transmitted to carrier upon truck departure
- **Ship confirm:** Triggers inventory adjustment (goods issue) in the WMS and notifies SAP via ERP Integration Layer (BAPI_GOODSMVT_CREATE, movement type 601)

## WCF Service Inventory

The WMS exposes approximately 15 WCF services via IIS:

| Service | Endpoint | Key Operations | Protocol |
|---------|----------|---------------|----------|
| ReceivingService | `/services/receiving.svc` | ReceiveASN, ConfirmReceipt, ReportDiscrepancy | SOAP/WCF |
| InventoryService | `/services/inventory.svc` | GetInventory, AdjustInventory, TransferStock, CycleCount | SOAP/WCF |
| PickingService | `/services/picking.svc` | GenerateWave, GetPickList, ConfirmPick, CancelPick | SOAP/WCF |
| PackingService | `/services/packing.svc` | GetPackOrder, ConfirmPack, PrintLabel, PrintPackSlip | SOAP/WCF |
| ShippingService | `/services/shipping.svc` | CreateShipment, GenerateBOL, RateShop, ConfirmShip | SOAP/WCF |
| LocationService | `/services/location.svc` | GetLocations, AssignBin, UpdateZone, GetZoneMap | SOAP/WCF |
| ReplenishmentService | `/services/replenishment.svc` | TriggerReplenishment, GetReplenishmentTasks | SOAP/WCF |
| OrderService | `/services/order.svc` | CreateOrder, GetOrderStatus, CancelOrder, UpdateOrder | SOAP/WCF |
| ReportingService | `/services/reporting.svc` | GetThroughput, GetInventorySnapshot, GetShipmentSummary | SOAP/WCF |
| IntegrationService | `/services/integration.svc` | SyncToSAP, ReceiveFromSAP, GetSyncStatus | SOAP/WCF |

Additional utility services exist for configuration management, user and role management, warehouse configuration, and audit logging (approximately 5 more services).

### REST Facade (In Progress)

The REST facade is being built incrementally as per [ADR-001](../architecture/adr/ADR-001-sap-integration-pattern.md). Priority is on endpoints that Route Optimization and Fleet Management need.

| Endpoint | Method | Purpose | Status |
|----------|--------|---------|--------|
| `/api/v1/inventory/{sku}` | GET | Get current inventory for a SKU across all warehouses | ✅ Available |
| `/api/v1/inventory/{sku}/{warehouseId}` | GET | Get inventory for a SKU at a specific warehouse | ✅ Available |
| `/api/v1/shipments` | POST | Create a new shipment | 🚧 In development |
| `/api/v1/shipments/{id}/status` | GET | Get shipment status | ✅ Available |
| `/api/v1/orders` | POST | Create order (used by Acme Retail) | ✅ Available |
| `/api/v1/orders/{id}` | GET | Get order details | ✅ Available |

_"The REST facade is being built incrementally as per ADR-001. Priority is on endpoints that Route Optimization and Fleet Management need."_

## SQL Server Schema — Key Tables

The following is representative DDL for the most important WMS tables (simplified for documentation purposes):

```sql
-- Core tables (representative DDL — simplified for documentation)
CREATE TABLE LOCATIONS (
    LocationId INT PRIMARY KEY,
    WarehouseId INT NOT NULL,
    Zone VARCHAR(20) NOT NULL,        -- BULK, PICK, RESERVE, STAGING, DOCK
    Aisle VARCHAR(10),
    Bay VARCHAR(10),
    Level VARCHAR(10),
    Bin VARCHAR(20),
    MaxWeight DECIMAL(10,2),
    MaxVolume DECIMAL(10,2),
    VelocityClass CHAR(1),            -- A, B, C
    IsActive BIT DEFAULT 1
);

CREATE TABLE INVENTORY (
    InventoryId BIGINT PRIMARY KEY,
    SKU VARCHAR(50) NOT NULL,
    LocationId INT FOREIGN KEY REFERENCES LOCATIONS,
    WarehouseId INT NOT NULL,
    LotNumber VARCHAR(50),
    Quantity DECIMAL(10,2),
    ReservedQty DECIMAL(10,2) DEFAULT 0,
    AvailableQty AS (Quantity - ReservedQty),
    ExpirationDate DATE,
    ReceivedDate DATETIME,
    LastCountDate DATETIME
);

CREATE TABLE PICK_WAVES (
    WaveId INT PRIMARY KEY,
    WarehouseId INT NOT NULL,
    WaveNumber VARCHAR(20),
    Status VARCHAR(20),               -- PLANNED, RELEASED, IN_PROGRESS, COMPLETE
    CarrierCutoffTime DATETIME,
    CreatedDate DATETIME,
    CompletedDate DATETIME,
    TotalLines INT,
    PickedLines INT
);

CREATE TABLE SHIPMENTS (
    ShipmentId BIGINT PRIMARY KEY,
    OrderId BIGINT,
    WarehouseId INT NOT NULL,
    CarrierCode VARCHAR(20),
    ServiceLevel VARCHAR(20),
    TrackingNumber VARCHAR(50),
    ShipDate DATE,
    Status VARCHAR(20),               -- CREATED, PACKED, SHIPPED, DELIVERED
    BOLNumber VARCHAR(50),
    Weight DECIMAL(10,2)
    -- Partitioned by ShipDate for query performance
);
```

Additional key tables: `PURCHASE_ORDERS`, `PICK_LISTS`, `PACK_ORDERS`, `CYCLE_COUNTS`, `INVENTORY_ADJUSTMENTS`, `WAREHOUSE_CONFIG`.

**Indexing strategy:** Clustered indexes on primary keys. Non-clustered indexes on frequently queried columns: `(SKU, WarehouseId)`, `(LocationId)`, `(Status, WarehouseId)`, `(ShipDate)`, `(TrackingNumber)`. The SHIPMENTS table is partitioned by ShipDate (monthly partitions, 24-month rolling window). INVENTORY_ADJUSTMENTS is also partitioned by date for regulatory retention (7 years).

## SAP Integration

The WMS integrates with SAP ECC for both master data and transactional data:

- **Goods receipt:** When receipt is confirmed in WMS, a synchronous WCF call is made through the ERP Integration Layer to SAP (BAPI_GOODSMVT_CREATE, movement type 101). SAP posts the goods receipt to MM (Materials Management).
- **Goods issue (ship confirm):** When shipment leaves the warehouse, WMS calls SAP (BAPI_GOODSMVT_CREATE, movement type 601) for goods issue posting.
- **Nightly reconciliation:** WMS inventory snapshot compared against SAP MM inventory. Discrepancies are logged to the `INVENTORY_ADJUSTMENTS` table and investigated. Typically 50–100 discrepancy records per night, mostly timing-related.
- **Product master data:** Received from SAP via MATMAS IDoc → ERP Integration Layer → WMS `PRODUCTS` table
- **Customer master data:** Received from SAP via DEBMAS IDoc → ERP Integration Layer → WMS `CUSTOMERS` table

## Barcode / RF Scanning Infrastructure

- **Hardware:** Zebra handheld RF terminals (TC52 and TC72 models)
- **Software:** Custom .NET Compact Framework application running on the scanners — this is legacy technology (Compact Framework is end-of-life)
- **Connectivity:** Wi-Fi connected to warehouse wireless LAN (Cisco access points, approximately one per 5,000 sqft)
- **Communication:** Scanner application communicates with WMS WCF services in real-time for pick, pack, receive, and put-away operations
- **Known issue:** Wi-Fi dead spots in some warehouse areas cause scanner disconnects. Reconnection logic is implemented in the scanner app but adds latency of 5–10 seconds per reconnect.

The RF scanner application replacement is tied to the WMS .NET 8 migration. The plan is to replace the .NET Compact Framework app with a web-based progressive web app (PWA) that runs in the scanner's built-in browser.

## Performance Characteristics

| Metric | Steady State | Peak (Holiday) |
|--------|-------------|----------------|
| Order lines per day per warehouse | ~50,000 | ~150,000 |
| Pick wave generation time | ~5 minutes | ~15 minutes |
| WCF service response (transactional) | 50–200 ms | 100–500 ms |
| WCF service response (reporting queries) | 1–3 seconds | 3–5 seconds |
| SQL Server CPU utilization | ~40% | ~75% |
| SQL Server storage per instance | ~2 TB | ~2 TB |
| Nightly SAP reconciliation | ~30 minutes | ~45 minutes |
| Replication lag (warehouse → Dallas) | < 1 second | 5–10 seconds |

## Known Issues

The following issues are known and tracked by the WMS team:

- _"The WMS was originally designed for a single warehouse. Multi-warehouse support was added incrementally and has known edge cases in cross-warehouse transfer logic. Specifically, if a transfer is initiated during a cycle count at the destination warehouse, the receiving quantity may not reconcile correctly. The workaround is to avoid transfers during active cycle counts — this is managed operationally but should be fixed in code."_
- **.NET Framework 4.6** is out of mainstream support. Security patches are no longer available from Microsoft. Migration to .NET 8 is planned but has not yet started — the estimate is 12–18 months of effort.
- **.NET Compact Framework** on RF scanners is end-of-life. Replacement (PWA on scanner browser) is tied to the .NET 8 migration timeline.
- **Wave generation performance** degrades during peak season when order volumes spike 3–4x. The team has discussed parallelizing wave generation across warehouse zones, but this requires schema changes to the PICK_WAVES and PICK_LISTS tables.
- **SQL Server 2016** is approaching end of extended support. Upgrade to SQL Server 2022 is planned alongside the .NET migration to minimize disruption.
- **Large WCF services:** InventoryService has grown to 30+ operations. Service decomposition has been discussed but is not prioritized over feature work and migration planning.

## Related Documentation

- **Architecture context:** See [Architecture Overview](../architecture/overview.md)
- **SAP integration pattern:** See [ADR-001](../architecture/adr/ADR-001-sap-integration-pattern.md)
- **System landscape:** See [System Landscape](system-landscape.md)
- **API contracts:** See [WMS API Contracts](../api/wms-api.md) for detailed SOAP and REST API specifications
