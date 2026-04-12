---
title: "Integration Specifications"
---


# Acme Distribution — Integration Specifications

> **Note:** Integration documentation is being consolidated as part of the GitHub migration. Some specifications may reference the previous Azure DevOps wiki format. The team is working toward standardized API documentation in Markdown.

## SAP ECC Integration Specifications

SAP ECC is the enterprise master data source managed by the Acme Corp SAP team. Acme Distribution integrates with SAP for master data synchronization and transactional postings. All SAP communication flows through the ERP Integration Layer (.NET/WCF middleware) via SAP PI (Process Integration).

### IDoc Interfaces

| IDoc Type | Direction | Purpose | Frequency |
|-----------|-----------|---------|-----------|
| MATMAS | SAP → WMS | Material (product) master data — product descriptions, dimensions, weight, classification | Near real-time (triggered on change in SAP) |
| DEBMAS | SAP → WMS | Customer master data — customer name, addresses, credit terms, shipping preferences | Near real-time (triggered on change in SAP) |
| DESADV | Supplier → SAP → WMS | Advanced Shipping Notice — expected inbound deliveries from suppliers | As received from suppliers |
| WMMBXY | WMS → SAP | Goods movements — receipt, issue, transfer, and adjustment postings | Real-time (per transaction) |

**IDoc processing flow:**
1. SAP ECC generates the IDoc (e.g., MATMAS when a product is changed)
2. SAP PI receives the IDoc and applies mapping rules to transform it into the format expected by the ERP Integration Layer
3. SAP PI sends the transformed message via SOAP/HTTP to the ERP Integration Layer
4. ERP Integration Layer processes the message and updates the WMS database
5. Acknowledgment is sent back through SAP PI to SAP ECC

### BAPI Calls

| BAPI | Direction | Purpose | When Called |
|------|-----------|---------|------------|
| BAPI_GOODSMVT_CREATE | WMS → SAP | Post goods receipt (movement type 101) or goods issue (movement type 601) | On every receipt confirmation and ship confirmation |
| BAPI_MATERIAL_GETDETAIL | WMS → SAP | Get detailed material information (on-demand lookup for data not in IDoc master) | Ad-hoc, used for troubleshooting and validation |

**BAPI call flow:**
1. WMS triggers the business event (e.g., ship confirmation)
2. WMS calls the ERP Integration Layer via WCF service (IntegrationService.SyncToSAP)
3. ERP Integration Layer formats the BAPI call parameters
4. SAP PI routes the RFC call to SAP ECC
5. SAP ECC processes the goods movement and returns a material document number
6. The material document number is stored in the WMS SHIPMENTS table for audit trail

### Connection Architecture

- **SAP PI middleware** handles all message routing between SAP ECC and Acme Distribution
- **RFC destinations** are configured in SAP for each integration point (one for IDoc inbound, one for BAPI outbound)
- **ERP Integration Layer** (.NET/WCF) sits between SAP PI and the WMS, providing protocol translation and error handling
- **Message flow:** SAP ECC → SAP PI → (SOAP/HTTP) → ERP Integration Layer → (WCF) → WMS
- **Monitoring:** SAP PI provides message monitoring for IDoc/BAPI processing. The ERP Integration Layer logs all messages to a SQL Server `INTEGRATION_LOG` table for troubleshooting.
- **SLA:** IDoc processing within 15 minutes of SAP change. Actual performance: typically 2–5 minutes, can spike to 15–30 minutes during peak periods due to SAP PI queue depth.

## Acme Retail Integration

Acme Retail is Acme Distribution's largest client (~60% of volume). The integration is bidirectional: Retail sends orders to Distribution, and Distribution sends status updates back to Retail.

### Inbound — Order Creation

Acme Retail creates orders in the WMS via the REST facade:

- **Endpoint:** `POST /api/v1/orders` on the WMS REST facade
- **Authentication:** API key (header: `X-API-Key`) — Retail has a dedicated API key
- **Volume:** ~15,000 orders per day from Retail (60% of total WMS order volume)
- **Payload:** Order lines with SKU, quantity, shipping address, priority, and requested ship date

The WMS validates the order (inventory availability, address validation) and returns an order ID and initial status. If inventory is insufficient, the WMS returns an `INV-1001` error and the order is not created.

### Outbound — Order Status Updates (Webhooks)

The WMS sends status updates to Acme Retail as orders progress through fulfillment:

- **Mechanism:** REST webhook — `POST` to Retail's configured callback URL
- **Authentication:** Acme Retail provides a pre-shared API key that the WMS includes in the `X-API-Key` header of webhook calls
- **Events:**
  - `ORDER_RECEIVED` — order accepted by WMS
  - `ORDER_PICKING` — pick wave released, order is being picked
  - `ORDER_PACKED` — order packed and labeled
  - `ORDER_SHIPPED` — order has left the warehouse (includes tracking number)
  - `ORDER_DELIVERED` — delivery confirmed (includes proof-of-delivery URL)

**Webhook payload example:**

```json
{
  "event": "ORDER_SHIPPED",
  "orderId": "RETAIL-ORD-2024-445612",
  "wmsOrderId": "WMS-ORD-2024-889123",
  "status": "SHIPPED",
  "timestamp": "2024-03-16T08:15:00Z",
  "shipment": {
    "carrier": "FEDEX",
    "serviceLevel": "GROUND",
    "trackingNumber": "794644790132",
    "estimatedDelivery": "2024-03-18"
  }
}
```

**Retry policy:** 3 retries with exponential backoff (1 minute, 5 minutes, 15 minutes). After 3 consecutive failures, the event is written to a dead-letter queue and flagged for manual review by the operations team. Failed webhooks are monitored daily.

## Shipping Carrier Integrations

Acme Distribution integrates with three shipping carriers for label generation, tracking, and rate inquiry.

### DHL Integration

- **Protocol:** REST API (DHL Express API)
- **Authentication:** OAuth 2.0 (DHL Developer Portal credentials)
- **Operations:**
  - **Label generation:** `POST /shipments` — generates a shipping label (PDF), returns tracking number and label URL
  - **Tracking:** Webhook — DHL sends tracking status events to Acme Distribution's callback URL as packages move through the DHL network
  - **Rate inquiry:** `GET /rates` — get shipping rates for a given origin, destination, weight, and service level
- **Environment:** Production API; sandbox environment available for testing new integrations
- **Volume:** ~3,000 labels per day
- **SLA:** Label generation typically completes in 1–3 seconds. Rate inquiry: 500 ms–2 seconds.

### FedEx Integration

- **Protocol:** REST API (FedEx Ship API v1)
- **Authentication:** OAuth 2.0 (FedEx Developer Portal credentials)
- **Operations:**
  - **Label generation:** `POST /ship/v1/shipments` — generates shipping label, returns tracking number
  - **Tracking:** Webhook — FedEx Track API sends tracking updates to callback URL
  - **Rate inquiry:** `POST /rate/v1/rates` — get shipping rates for package specifications
- **Volume:** ~5,000 labels per day (primary carrier — handles the majority of shipments)
- **SLA:** Similar to DHL — label generation in 1–3 seconds.

### USPS Integration

- **Protocol:** Batch file — CSV upload for bulk label generation
- **Authentication:** USPS Web Tools API credentials
- **Operations:** Label generation only (no real-time API integration). Labels are generated in an overnight batch for next-day shipments.
- **Volume:** ~1,000 labels per day (used for lightweight, low-priority shipments — media mail, marketing materials)
- **Limitations:** No real-time tracking integration. Tracking numbers are available after batch processing but tracking events are not pushed via webhook.

> _"The USPS integration is the oldest and least automated. The team has discussed migrating to the USPS REST API (Web Tools v4) for real-time label generation, but this hasn't been prioritized given the low volume and non-critical nature of USPS shipments."_

### Carrier Selection Logic

The WMS ShippingService selects a carrier based on the following priority rules:

1. **Service level requirement:** Next-day → FedEx Priority Overnight; 2-day → FedEx 2Day or DHL Express; Ground → rate shop between FedEx and DHL
2. **Package dimensions and weight:** Oversized or heavy packages may be restricted to certain carriers
3. **Destination zone:** Domestic continental US is served by all carriers; Hawaii/Alaska uses FedEx only
4. **Rate comparison:** For eligible service levels, the system performs a rate shop (calls DHL and FedEx rate APIs) and selects the lowest cost option
5. **Client preference:** Some 3PL client contracts specify a required carrier — these override the rate shop logic

## Rate Limits and Quotas

| API | Rate Limit | Current Usage | Notes |
|-----|-----------|---------------|-------|
| HERE Maps (Route Optimization) | 250,000 transactions/month | ~150,000/month | Approaching limit during peak — upgrade under discussion |
| DHL Express API | 10,000 requests/hour | ~500/hour peak | Well within limits |
| FedEx Ship API | 10,000 requests/hour | ~800/hour peak | Well within limits |
| Twilio SMS (IoT alerts) | 500 messages/second | ~50/day average | Well within limits |
| WEX Fuel API (Fleet) | Nightly batch | 1 call/day | Batch import, no rate concern |

## Related Documentation

- **API landscape overview:** See [API Overview](overview.md) for authentication and protocol summary
- **WMS API contracts:** See [WMS API Contracts](wms-api.md) for detailed SOAP and REST specifications
- **Architecture / ADR-001:** See [Architecture Overview](../architecture/overview.md) and [ADR-001](../architecture/adr/ADR-001-sap-integration-pattern.md) for SAP integration decision context
- **Data architecture:** See [Data Architecture](../data/architecture.md) for data flow patterns
- **System landscape:** See [System Landscape](../technical/system-landscape.md) for third-party system inventory
