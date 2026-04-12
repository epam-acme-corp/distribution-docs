---
title: "Data Architecture"
---


# Acme Distribution — Data Architecture

> **Note:** Data architecture documentation is being consolidated as part of the GitHub migration. Some data flow diagrams from the Azure DevOps wiki have not yet been migrated. Proper data flow diagrams are a future deliverable.

## Database Landscape Overview

Acme Distribution operates a diverse database landscape spanning five different database technologies across its six core systems. Each system uses the database best suited to its workload, resulting in a heterogeneous environment that provides technical advantages (right tool for the job) but also introduces challenges around data integration, consistency, and operational overhead.

| System | Database | Version | Deployment | Size | Purpose |
|--------|----------|---------|------------|------|---------|
| WMS | SQL Server | 2016 | On-premises (Dallas central + replicas per warehouse) | ~2 TB per instance | Inventory, orders, shipments, pick/pack/ship |
| Route Optimisation | PostgreSQL | 14 | Azure Managed (flexible server) | ~50 GB | Routes, stops, optimization results |
| Fleet Management | MySQL | 8 | Azure Managed (flexible server) | ~200 GB | Vehicles, drivers, maintenance, fuel, current GPS |
| IoT Tracking Platform | InfluxDB | 2 | Azure VM (dedicated) | ~500 GB (growing ~50 GB/month) | Time-series sensor and GPS data |
| Driver Mobile App | SQLite | — (embedded) | On-device (Android/iOS) | ~50 MB per device | Local cache: route, stops, delivery confirmations |
| SAP ECC (external) | SAP HANA | Managed by SAP team | Corporate data center | — | Master data: products, customers, pricing |

### Key Characteristics

- No single unified data platform — each system owns its data store
- SQL Server (WMS) is the largest and most business-critical database
- InfluxDB handles the highest write throughput (~5,000 writes/second, ~100 million data points per day)
- SQLite on mobile devices introduces offline/sync challenges that affect data freshness
- SAP ECC is the authoritative source for master data but is managed by a separate corporate team with its own change management process

## Data Volumes and Growth

| Data Domain | Volume | Growth Rate | Retention | Notes |
|------------|--------|-------------|-----------|-------|
| WMS — Inventory records | ~50 million active records | Relatively stable | Indefinite (active), 7 years (archived) | Across all 5 warehouse instances |
| WMS — Shipment records | ~10 million per year | ~15% YoY growth | 7 years (regulatory) | Partitioned by ship date |
| WMS — Pick waves | ~500,000 per year | ~15% YoY growth | 3 years | Archived after 3 years |
| IoT — Sensor data points | ~100 million per day | ~20% YoY (new devices) | Raw: 90 days, Downsampled: 2 years | Highest volume data source |
| Fleet — GPS positions | ~500 million per year | ~10% YoY | Raw: 90 days (InfluxDB), Summary: 2 years (MySQL) | Dual storage pattern |
| Route Optimization — Routes | ~365,000 per year (~1,000/day) | ~15% YoY | 2 years | Including all stops and ETAs |
| Mobile — Delivery confirmations | ~6 million per year | ~15% YoY | Synced to WMS, local purge after 30 days | Photos stored in Azure Blob Storage |

## SQL Server WMS Schema — Detailed

The WMS SQL Server database is the largest and most complex in the landscape. Key tables and their characteristics:

### Core Tables

- **INVENTORY** — ~50 million active rows across all warehouse instances. Clustered index on `InventoryId`. Non-clustered indexes on `(SKU, WarehouseId)`, `(LocationId)`, and `(ExpirationDate)` for expiry-based picking queries.
- **SHIPMENTS** — ~10 million rows per year. **Partitioned by `ShipDate`** using monthly partitions with a 24-month rolling window. Clustered index on `(ShipDate, ShipmentId)` aligned with the partition scheme. Non-clustered indexes on `(OrderId)`, `(TrackingNumber)`, and `(Status, WarehouseId)`.
- **PICK_WAVES** — ~500,000 rows per year. Clustered on `WaveId`. Non-clustered index on `(WarehouseId, Status)` for active wave queries.
- **PICK_LISTS** — ~5 million rows per year (average 10 lines per wave). Clustered on `PickListId`. Non-clustered on `(WaveId)` and `(SKU, WarehouseId)`.
- **LOCATIONS** — ~50,000 rows (relatively static — warehouse layout rarely changes). Clustered on `LocationId`. Non-clustered on `(WarehouseId, Zone)`.
- **PURCHASE_ORDERS** — ~200,000 rows per year. Clustered on `POId`. Non-clustered on `(SupplierCode)` and `(ExpectedDate)`.
- **INVENTORY_ADJUSTMENTS** — Audit trail of all inventory changes. ~20 million rows per year. Partitioned by `AdjustmentDate` (monthly). Regulatory retention: 7 years.

### Partitioning Strategy

- SHIPMENTS and INVENTORY_ADJUSTMENTS are partitioned by date using monthly partition boundaries
- Partition maintenance is handled by a scheduled SQL Server Agent job that creates new partitions one month ahead and merges old partitions beyond the retention window
- Partition switching is used for archival — old partitions are switched to archive filegroups on separate storage

### Replication

- Each warehouse has a local SQL Server instance optimized for low-latency WMS operations
- Transactional replication pushes data from local instances to the central Dallas instance for cross-warehouse reporting and nightly SAP reconciliation
- Replication lag: typically < 1 second during normal operations; can reach 5–10 seconds during peak season due to transaction volume

For detailed WMS schema DDL, see [WMS Deep-Dive](../technical/wms.md).

## Data Flows

### SAP → WMS (Master Data)

- **Product master:** SAP sends MATMAS IDocs when products are created or changed → ERP Integration Layer processes the IDoc → WMS `PRODUCTS` table is updated
- **Customer master:** SAP sends DEBMAS IDocs when customer records change → ERP Integration Layer → WMS `CUSTOMERS` table
- **Pricing:** Nightly batch extract from SAP → flat file transfer → WMS `PRICING` table
- **Frequency:** IDocs are near real-time (typically 2–5 minutes from SAP change). Pricing is nightly only.
- **Known issue:** _"SAP master data sync has a known 15-minute lag during peak periods. When SAP PI queue depth increases during high-volume master data changes, IDoc processing can take 15–30 minutes instead of the typical 2–5 minutes. This causes mismatches between SAP and WMS data. The nightly reconciliation batch catches these, but intraday discrepancies can affect order processing — for example, a new product may not be available in WMS for 15–30 minutes after SAP creation."_

### WMS → SAP (Transactional)

- **Goods receipt:** WMS confirms receipt → ERP Integration Layer calls BAPI_GOODSMVT_CREATE → SAP posts goods receipt (movement type 101)
- **Goods issue (shipment):** WMS confirms ship → ERP Integration Layer calls BAPI_GOODSMVT_CREATE → SAP posts goods issue (movement type 601)
- **Inventory adjustments:** WMS cycle count adjustments → ERP Integration Layer → SAP inventory adjustment posting
- **Frequency:** Real-time — synchronous WCF call per transaction. Each receipt confirmation and ship confirmation results in an immediate SAP posting.

### WMS → Acme Retail

- Order status updates sent as webhook notifications to Acme Retail's order management system
- **Events:** `ORDER_RECEIVED`, `ORDER_PICKING`, `ORDER_PACKED`, `ORDER_SHIPPED`, `ORDER_DELIVERED`
- REST webhook: `POST` to Retail's configured callback URL with order status payload including tracking number (when shipped) and proof-of-delivery URL (when delivered)
- **Retry logic:** 3 retries with exponential backoff (1 min, 5 min, 15 min). After 3 failures, the event is queued for manual review by the operations team.

### IoT → Cross-System

- IoT Platform stores all sensor and GPS telemetry in InfluxDB
- **Fleet Management** queries the IoT Platform REST API for historical vehicle positions (analytics, route compliance analysis)
- **WMS** queries the IoT Platform REST API for warehouse temperature data used in cold-chain compliance reports
- **Grafana** reads directly from InfluxDB for operational dashboards (no intermediary)

### Mobile Data Sync (Driver App)

- The Driver Mobile App uses SQLite for local on-device data storage
- **Sync pattern:** Pull route and stop data at start of day (or when route is updated); push delivery confirmations as each delivery is completed
- **Connectivity challenges:** Warehouse interiors have Wi-Fi dead spots; in-transit cellular connectivity is intermittent in rural areas
- **Conflict resolution:** Last-write-wins for most fields (e.g., driver status updates). Delivery confirmations are append-only records — no conflict possible since each confirmation is a unique event.
- **Photo uploads:** Proof-of-delivery photos are stored locally on the device, then uploaded to Azure Blob Storage when connectivity is available. The upload queue persists across app restarts — photos are not lost if the app is closed.
- **Sync lag:** During normal connectivity, sync completes within seconds. In low-connectivity areas, delivery confirmations may be delayed by minutes to hours. The WMS shows these orders as "in transit" until the mobile app syncs.

## ETL to Snowflake — Operational Analytics

Operational data from all Acme Distribution systems is extracted nightly to Snowflake for analytics and reporting. The Snowflake instance is managed by the Acme Corp central data team.

- **Orchestration:** Apache Airflow (managed instance on Azure)
- **Schedule:** Nightly, starting at 11:00 PM CT (after business hours across all time zones)

### Airflow DAGs

| DAG | Source | Target Schema | Description | Duration |
|-----|--------|--------------|-------------|----------|
| `wms_extract` | SQL Server (WMS) | `DIST_WMS` | Inventory snapshots, shipments, orders, pick waves | ~90 minutes |
| `route_extract` | PostgreSQL (Route Opt) | `DIST_ROUTES` | Routes, stops, optimization metrics | ~15 minutes |
| `fleet_extract` | MySQL (Fleet Mgmt) | `DIST_FLEET` | Vehicle data, maintenance, fuel, driver metrics | ~20 minutes |
| `iot_downsample` | InfluxDB (IoT) | `DIST_IOT` | Downsampled sensor and GPS data (hourly aggregates) | ~45 minutes |

**Total pipeline duration:** Approximately 3 hours. Data is available in Snowflake by 2:00 AM CT for morning reporting.

### Analytics Use Cases

- **Warehouse throughput:** Orders per hour, lines per labor hour, dock-to-stock time
- **Delivery performance:** On-time delivery rate, route efficiency (actual vs. planned), cost per delivery
- **Fleet efficiency:** Fleet utilization percentage, maintenance cost per mile, fuel consumption trends
- **Cold-chain compliance:** Temperature excursion frequency, duration, and root cause analysis
- **Financial reporting:** Cost allocation per client, per warehouse, per service line — feeds into billing and P&L reporting

### Known ETL Issues

- The `wms_extract` DAG is the slowest due to the volume of SQL Server data and replication lag from remote warehouse instances. The extract waits for replication to stabilize before querying the central Dallas instance.
- The `iot_downsample` DAG occasionally fails due to InfluxDB query timeout when querying large time ranges. Retry logic handles this but delays the pipeline by 15–30 minutes when it occurs.
- Snowflake schema changes require coordination with the central data team. Schema migration requests typically take 1–2 sprint cycles to schedule and deploy.

## Data Quality Challenges

The following data quality issues are known and actively managed:

- **SAP master data lag:** The 15-minute IDoc processing lag during peak periods means the WMS can temporarily have stale product or pricing data. During holiday season, this lag can extend to 30+ minutes due to SAP PI queue depth. Impact: orders may fail validation if a new product hasn't synced to WMS yet.
- **Inventory reconciliation discrepancies:** Nightly WMS ↔ SAP reconciliation typically finds 50–100 discrepancy records per night. Most (~95%) are timing-related — transactions that were in-flight during the snapshot window. Approximately 5% require manual investigation by the inventory control team.
- **Mobile data sync gaps:** When drivers are in areas with poor cellular connectivity, delivery confirmations may be delayed by hours. The WMS shows these orders as "in transit" until the mobile app syncs, which can create confusion for customer service agents checking order status.
- **IoT data gaps:** If a sensor loses connectivity or runs out of battery, the corresponding time range has no data in InfluxDB. InfluxDB does not fill gaps — downstream analytics queries and Grafana dashboards must handle nulls. Cold-chain compliance reports flag these gaps for investigation.
- **Cross-system consistency:** There is no single source of truth for real-time inventory across all views: the WMS has the operational view (physical stock), SAP has the financial view (book inventory), and IoT sensors have the physical environmental view (temperature, conditions). Reconciliation across these views is an ongoing challenge managed through nightly batch processes.
- **Duplicate GPS records:** The QoS 1 MQTT delivery guarantee for GPS data can result in duplicate position records in InfluxDB. Downstream consumers must deduplicate by `(vehicleId, timestamp)` pair.

## Data Governance and Compliance

- **Regulatory retention:** Shipment records must be retained for 7 years for customs and tax compliance. INVENTORY_ADJUSTMENTS also have a 7-year retention for audit purposes.
- **CCPA:** Customer delivery addresses are PII (Personally Identifiable Information). Retention is limited to business need plus 30 days post-delivery for dispute resolution. Beyond that window, addresses are anonymized in analytics data.
- **Cold-chain audit trail:** FDA requires temperature records for food and pharmaceutical shipments. IoT retention policies (90-day raw, 2-year downsampled) exceed minimum requirements.
- **Data classification:** Currently informal. The Platform team has flagged the need for a formal data classification effort (public, internal, confidential, restricted) as part of the GitHub platform maturation roadmap. This has not yet been scheduled.

## Related Documentation

- **System landscape:** See [System Landscape](../technical/system-landscape.md)
- **WMS schema detail:** See [WMS Deep-Dive](../technical/wms.md) for detailed DDL
- **IoT data store:** See [IoT Tracking Platform](../technical/iot-tracking.md) for InfluxDB schema detail
- **Architecture overview:** See [Architecture Overview](../architecture/overview.md) for system interaction context
