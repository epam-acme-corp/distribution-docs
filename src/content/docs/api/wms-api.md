---
title: "WMS API Contracts"
---


# Acme Distribution — WMS API Contracts

> **Note:** API documentation is being consolidated as part of the GitHub migration. Formal OpenAPI/Swagger specifications do not yet exist for the REST facade — this is a known gap. SOAP WSDLs are available at each service's `.svc?wsdl` endpoint.

## WMS SOAP Services (WCF)

The WMS exposes approximately 15 WCF services hosted on IIS. All SOAP services use basic authentication (username/password over TLS). The base URL is `https://wms.acme-dist.internal/services/`.

### ReceivingService

**Endpoint:** `/services/receiving.svc`

| Operation | Description | Key Parameters |
|-----------|-------------|---------------|
| `ReceiveASN` | Register an Advanced Shipping Notice for an expected inbound delivery | ASNNumber, SupplierCode, ExpectedDate, LineItems[] |
| `ConfirmReceipt` | Confirm physical receipt of goods against an ASN | ASNNumber, ReceivedItems[] (SKU, Qty, LotNumber, Condition) |
| `ReportDiscrepancy` | Report over/short/damage against an ASN receipt | ASNNumber, SKU, ExpectedQty, ReceivedQty, DiscrepancyType |

**Example — `ConfirmReceipt` Request:**

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wms="http://acme-dist.internal/wms/receiving">
  <soapenv:Body>
    <wms:ConfirmReceiptRequest>
      <wms:ASNNumber>ASN-2024-031542</wms:ASNNumber>
      <wms:WarehouseId>DAL01</wms:WarehouseId>
      <wms:ReceivedItems>
        <wms:Item>
          <wms:SKU>ACM-WIDGET-001</wms:SKU>
          <wms:Quantity>500</wms:Quantity>
          <wms:LotNumber>LOT-20240315-A</wms:LotNumber>
          <wms:Condition>GOOD</wms:Condition>
          <wms:DockLocation>DAL01-RECV-DOCK03</wms:DockLocation>
        </wms:Item>
      </wms:ReceivedItems>
      <wms:ReceivedBy>JSMITH</wms:ReceivedBy>
      <wms:ReceivedDate>2024-03-15T10:30:00</wms:ReceivedDate>
    </wms:ConfirmReceiptRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

**Example — `ConfirmReceipt` Response:**

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wms="http://acme-dist.internal/wms/receiving">
  <soapenv:Body>
    <wms:ConfirmReceiptResponse>
      <wms:Status>SUCCESS</wms:Status>
      <wms:ReceiptId>RCV-2024-089234</wms:ReceiptId>
      <wms:PutAwayTasks>
        <wms:Task>
          <wms:TaskId>PA-2024-445612</wms:TaskId>
          <wms:SKU>ACM-WIDGET-001</wms:SKU>
          <wms:FromLocation>DAL01-RECV-DOCK03</wms:FromLocation>
          <wms:ToLocation>DAL01-BULK-A04-03-02</wms:ToLocation>
          <wms:Quantity>500</wms:Quantity>
        </wms:Task>
      </wms:PutAwayTasks>
    </wms:ConfirmReceiptResponse>
  </soapenv:Body>
</soapenv:Envelope>
```

### InventoryService

**Endpoint:** `/services/inventory.svc`

| Operation | Description | Key Parameters |
|-----------|-------------|---------------|
| `GetInventory` | Query current inventory for a SKU or location | SKU (optional), WarehouseId, LocationId (optional), IncludeReserved |
| `AdjustInventory` | Record an inventory adjustment (cycle count, damage, etc.) | SKU, WarehouseId, LocationId, AdjustmentQty, ReasonCode, AdjustedBy |
| `TransferStock` | Initiate inter-warehouse or intra-warehouse stock transfer | SKU, FromWarehouseId, FromLocationId, ToWarehouseId, ToLocationId, Qty |
| `CycleCount` | Record a cycle count result | SKU, LocationId, CountedQty, CountedBy |

**Example — `GetInventory` Request:**

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wms="http://acme-dist.internal/wms/inventory">
  <soapenv:Body>
    <wms:GetInventoryRequest>
      <wms:SKU>ACM-WIDGET-001</wms:SKU>
      <wms:WarehouseId>DAL01</wms:WarehouseId>
      <wms:IncludeReserved>true</wms:IncludeReserved>
    </wms:GetInventoryRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

**Example — `GetInventory` Response:**

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wms="http://acme-dist.internal/wms/inventory">
  <soapenv:Body>
    <wms:GetInventoryResponse>
      <wms:SKU>ACM-WIDGET-001</wms:SKU>
      <wms:WarehouseId>DAL01</wms:WarehouseId>
      <wms:TotalOnHand>4800</wms:TotalOnHand>
      <wms:TotalReserved>300</wms:TotalReserved>
      <wms:TotalAvailable>4500</wms:TotalAvailable>
      <wms:Locations>
        <wms:Location>
          <wms:LocationId>DAL01-PICK-B02-01-03</wms:LocationId>
          <wms:Zone>PICK</wms:Zone>
          <wms:OnHand>200</wms:OnHand>
          <wms:Reserved>50</wms:Reserved>
        </wms:Location>
        <wms:Location>
          <wms:LocationId>DAL01-BULK-A04-03-02</wms:LocationId>
          <wms:Zone>BULK</wms:Zone>
          <wms:OnHand>4600</wms:OnHand>
          <wms:Reserved>250</wms:Reserved>
        </wms:Location>
      </wms:Locations>
    </wms:GetInventoryResponse>
  </soapenv:Body>
</soapenv:Envelope>
```

### ShippingService

**Endpoint:** `/services/shipping.svc`

| Operation | Description | Key Parameters |
|-----------|-------------|---------------|
| `CreateShipment` | Create a new shipment for an order | OrderId, WarehouseId, CarrierCode, ServiceLevel, Packages[] |
| `GenerateBOL` | Generate Bill of Lading for LTL shipments | ShipmentId, CarrierCode, ConsigneeInfo |
| `RateShop` | Get carrier rates for a shipment | WarehouseId, DestinationZip, Weight, Dimensions, ServiceLevel |
| `ConfirmShip` | Confirm shipment has left the warehouse | ShipmentId, TrackingNumber, ActualShipDate, ActualWeight |

**Example — `CreateShipment` Request:**

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wms="http://acme-dist.internal/wms/shipping">
  <soapenv:Body>
    <wms:CreateShipmentRequest>
      <wms:OrderId>WMS-ORD-2024-889123</wms:OrderId>
      <wms:WarehouseId>DAL01</wms:WarehouseId>
      <wms:CarrierCode>FEDEX</wms:CarrierCode>
      <wms:ServiceLevel>GROUND</wms:ServiceLevel>
      <wms:Packages>
        <wms:Package>
          <wms:Weight>5.2</wms:Weight>
          <wms:Length>12</wms:Length>
          <wms:Width>10</wms:Width>
          <wms:Height>8</wms:Height>
        </wms:Package>
      </wms:Packages>
    </wms:CreateShipmentRequest>
  </soapenv:Body>
</soapenv:Envelope>
```

**Example — `CreateShipment` Response:**

```xml
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:wms="http://acme-dist.internal/wms/shipping">
  <soapenv:Body>
    <wms:CreateShipmentResponse>
      <wms:Status>SUCCESS</wms:Status>
      <wms:ShipmentId>SHP-2024-556789</wms:ShipmentId>
      <wms:TrackingNumber>794644790132</wms:TrackingNumber>
      <wms:LabelUrl>https://wms.acme-dist.internal/labels/SHP-2024-556789.pdf</wms:LabelUrl>
      <wms:EstimatedDelivery>2024-03-18</wms:EstimatedDelivery>
    </wms:CreateShipmentResponse>
  </soapenv:Body>
</soapenv:Envelope>
```

### SOAP Fault — Error Handling

All WMS WCF services return SOAP faults for error conditions. Each fault includes an application-specific error code:

```xml
<soapenv:Fault>
  <faultcode>soapenv:Server</faultcode>
  <faultstring>Inventory insufficient for SKU ACM-WIDGET-001 at warehouse DAL01</faultstring>
  <detail>
    <wms:ErrorCode>INV-1001</wms:ErrorCode>
    <wms:AvailableQuantity>200</wms:AvailableQuantity>
    <wms:RequestedQuantity>500</wms:RequestedQuantity>
  </detail>
</soapenv:Fault>
```

**Common WMS Error Codes:**

| Code | Description |
|------|-------------|
| INV-1001 | Insufficient inventory for the requested SKU and warehouse |
| ORD-2001 | Order not found |
| ORD-2002 | Order already in a terminal state (cannot be modified) |
| RCV-3001 | ASN not found or already fully received |
| SHP-4001 | Carrier unavailable for the requested service level |
| SHP-4002 | Rate shop returned no valid rates |
| LOC-5001 | Location not found or not active |
| LOC-5002 | Location is full (cannot accept put-away) |

## WMS REST Facade (In Progress)

The REST facade is being built incrementally per [ADR-001](../architecture/adr/ADR-001-sap-integration-pattern.md). All REST endpoints use API key authentication (header: `X-API-Key`). Base URL: `https://wms.acme-dist.internal/api/v1/`.

| Endpoint | Method | Status | Description |
|----------|--------|--------|-------------|
| `/api/v1/inventory/{sku}` | GET | ✅ Available | Get inventory across all warehouses |
| `/api/v1/inventory/{sku}/{warehouseId}` | GET | ✅ Available | Get inventory at specific warehouse |
| `/api/v1/shipments` | POST | 🚧 In Development | Create shipment |
| `/api/v1/shipments/{id}/status` | GET | ✅ Available | Get shipment status |
| `/api/v1/orders` | POST | ✅ Available | Create order (primary consumer: Acme Retail) |
| `/api/v1/orders/{id}` | GET | ✅ Available | Get order details |
| `/api/v1/orders/{id}/status` | GET | ✅ Available | Get order status |

### Example — `GET /api/v1/inventory/{sku}` Response

```json
{
  "sku": "ACM-WIDGET-001",
  "description": "Acme Widget Model A",
  "totalAvailable": 15230,
  "warehouses": [
    {
      "warehouseId": "DAL01",
      "available": 4500,
      "reserved": 300,
      "onHand": 4800
    },
    {
      "warehouseId": "CHI01",
      "available": 3200,
      "reserved": 150,
      "onHand": 3350
    }
  ],
  "lastUpdated": "2024-03-15T14:30:00Z"
}
```

### Example — `POST /api/v1/orders` Request

```json
{
  "externalOrderId": "RETAIL-ORD-2024-445612",
  "clientCode": "ACME-RETAIL",
  "warehouseId": "DAL01",
  "priority": "STANDARD",
  "requestedShipDate": "2024-03-16",
  "shipTo": {
    "name": "John Smith",
    "address1": "123 Main St",
    "city": "Plano",
    "state": "TX",
    "zip": "75024"
  },
  "lines": [
    {
      "sku": "ACM-WIDGET-001",
      "quantity": 2,
      "unitPrice": 29.99
    }
  ]
}
```

### REST Error Response Format

```json
{
  "error": {
    "code": "INV-1001",
    "message": "Insufficient inventory for SKU ACM-WIDGET-001 at warehouse DAL01",
    "details": {
      "available": 200,
      "requested": 500
    }
  }
}
```

REST API errors use standard HTTP status codes: `400` for validation errors, `404` for not found, `409` for conflict (e.g., order already shipped), `500` for server errors. The error body includes the same application error codes used in SOAP faults for consistency.

## Related Documentation

- **WMS deep-dive:** See [WMS Deep-Dive](../technical/wms.md) for WCF service inventory and system architecture
- **SAP integration pattern:** See [ADR-001](../architecture/adr/ADR-001-sap-integration-pattern.md) for the REST facade decision rationale
- **Integration specifications:** See [Integration Specifications](integration-specs.md) for SAP, Retail, and carrier integrations
- **API landscape:** See [API Overview](overview.md) for the full API landscape summary
