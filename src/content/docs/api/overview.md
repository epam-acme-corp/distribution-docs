---
title: "API Landscape Overview"
---


# Acme Distribution — API Landscape Overview

> **Note:** API documentation is being consolidated as part of the GitHub migration. Some specifications may reference the previous Azure DevOps wiki format. The team is working to standardize API documentation in Markdown within the respective GitHub repositories.

## API Landscape Summary

Acme Distribution's API landscape reflects the heterogeneous technology stack — a mix of SOAP/WCF services, REST APIs, MQTT, and SAP-native protocols. Authentication mechanisms vary across services, which is a known concern being addressed in the platform maturation roadmap.

| System | Protocol | Auth Method | Base URL / Endpoint | Status |
|--------|----------|-------------|---------------------|--------|
| WMS — WCF Services | SOAP/XML | Basic Auth (username/password) | `https://wms.acme-dist.internal/services/*.svc` | Production — legacy |
| WMS — REST Facade | REST/JSON | API Key (header: `X-API-Key`) | `https://wms.acme-dist.internal/api/v1/*` | Partial — in development |
| Route Optimisation | REST/JSON | API Key (header: `X-API-Key`) | `https://routes.acme-dist.internal/api/*` | Production |
| Fleet Management | REST/JSON | API Key (header: `X-API-Key`) | `https://fleet.acme-dist.internal/api/*` | Production |
| IoT Platform | REST/JSON + MQTT | API Key (REST), TLS client cert (MQTT) | REST: `https://iot.acme-dist.internal/api/*`, MQTT: `mqtts://mqtt.acme-dist.internal:8883` | Production |
| ERP Integration Layer | SOAP/XML | Mutual TLS (certificate-based) | `https://erp-int.acme-dist.internal/services/*` | Production — legacy |
| SAP ECC | IDoc/BAPI/RFC | SAP RFC credentials | Via SAP PI middleware | Production |

## Authentication Landscape

The current authentication mechanisms across services:

- **API Key (internal REST services):** API keys are generated per consuming application and stored in Azure Key Vault. Keys are rotated annually. The Platform team has noted that annual rotation is insufficient and more frequent rotation should be implemented.
- **Basic Auth (SOAP services):** WMS WCF services use basic authentication with service account credentials (username/password). Credentials are transmitted over TLS, but basic authentication is flagged as a security improvement item — it should be replaced with certificate-based or token-based authentication.
- **Mutual TLS (ERP Integration):** The ERP Integration Layer and SAP PI middleware communicate using mutual TLS with client certificates managed by the infrastructure team. Certificates are renewed annually.
- **MQTT TLS (IoT):** IoT devices authenticate to the MQTT broker using TLS client certificates provisioned during device registration. Each device has a unique certificate.

> _"The mix of authentication methods across services is a known concern. A security review is planned to standardize on OAuth 2.0 / JWT for internal service-to-service communication. This is on the Platform team's roadmap but has not been scheduled."_

## API Documentation Standards

- REST APIs follow general REST conventions but **do not have formal OpenAPI/Swagger specifications** yet. Generating OpenAPI specs is a post-migration improvement item.
- SOAP services have WSDLs available at their respective `.svc?wsdl` endpoints
- **API versioning:** REST APIs use URL path versioning (`/api/v1/...`). SOAP services are not versioned — breaking changes are coordinated through internal communication.
- **Error handling:** REST APIs return standard HTTP status codes with JSON error bodies. SOAP services return SOAP faults with application-specific fault codes.

## Detailed API Documentation

- **WMS SOAP and REST API contracts:** See [WMS API Contracts](wms-api.md) for detailed service operations, request/response examples, and error codes
- **Integration specifications (SAP, Retail, carriers):** See [Integration Specifications](integration-specs.md) for SAP IDoc/BAPI details, Acme Retail webhooks, and carrier API integrations
- **Individual service APIs** are also documented in their respective system deep-dive documents:
  - [Route Optimisation](../technical/route-optimization.md) — route planning and optimization API
  - [Fleet Management](../technical/fleet-management.md) — vehicle, driver, and fuel APIs
  - [IoT Tracking Platform](../technical/iot-tracking.md) — sensor data and alerting APIs
