---
title: "System Landscape and Post-Migration Status"
---


# Acme Distribution — System Landscape and Post-Migration Status

> **Note:** Some documentation still references Azure DevOps pipelines and work items. These references should be considered outdated. The canonical source of truth for all CI/CD pipelines is now GitHub Actions.

## System Inventory

Acme Distribution operates six core systems that collectively support warehouse operations, fleet management, delivery, and IoT telemetry. The technology landscape reflects organic growth over the past decade — the oldest system (WMS) runs on .NET Framework 4.6, while newer services use Python, Java, and Node.js on Azure Kubernetes Service.

| System | Technology | Database | Purpose | Team | Status |
|--------|-----------|----------|---------|------|--------|
| Warehouse Management System (WMS) | .NET Framework 4.6 / WCF | SQL Server 2016 | Inventory tracking, pick/pack/ship, warehouse operations | WMS Team (15 devs) | Production — legacy, on-prem IIS |
| Route Optimisation Service | Python 3.10 / Flask | PostgreSQL 14 | Delivery route planning, Google OR-Tools VRP solver | Logistics Team (8 devs) | Production — AKS |
| Fleet Management | Java 11 / Spring Boot 2 | MySQL 8 | Vehicle tracking, maintenance scheduling, fuel management | Fleet/IoT Team (10 devs) | Production — AKS |
| ERP Integration Layer | .NET / WCF (SOAP/XML) | — (middleware) | SAP ECC to internal systems data synchronization | WMS Team | Production — on-prem IIS |
| IoT Tracking Platform | Node.js 18 / Express | InfluxDB 2 + MQTT broker | Warehouse sensors, GPS trackers, temperature monitoring | Fleet/IoT Team | Production — AKS |
| Driver Mobile App | Xamarin (legacy) | SQLite (local) + REST sync | Delivery confirmations, route navigation, proof-of-delivery | Logistics Team | Production — mobile |

### System Details

**Warehouse Management System (WMS)**
- Runtime: .NET Framework 4.6 with WCF (Windows Communication Foundation) services
- Database: SQL Server 2016 — the largest database in the Acme Distribution landscape (~2 TB per instance)
- Deployment: On-premises IIS (Windows Server 2016) at all 5 warehouse locations, each with a local instance syncing to a central SQL Server in Dallas
- Repository: `acme-dist-wms`
- CI: GitHub Actions — build + unit tests on push and PR (`.github/workflows/ci.yml`)
- CD: Not yet automated — deployments are scripted but run manually from jump boxes
- The WMS is the most critical and complex system; all order fulfillment flows through it

**Route Optimisation Service**
- Runtime: Python 3.10, Flask web framework
- Database: PostgreSQL 14 (Azure Managed — flexible server)
- Deployment: AKS — 3 replicas, 2 vCPU / 4 GB each
- Repository: `acme-dist-route-optimization`
- CI: GitHub Actions — build + unit tests + flake8 linting on push/PR
- Uses Google OR-Tools library for Vehicle Routing Problem (VRP) solving and HERE Maps API for distance matrices

**Fleet Management**
- Runtime: Java 11, Spring Boot 2
- Database: MySQL 8 (Azure Managed — flexible server)
- Deployment: AKS — 3 replicas, 2 vCPU / 4 GB each
- Repository: `acme-dist-fleet-management`
- CI: GitHub Actions — Maven build + unit tests + SpotBugs on push/PR
- Handles vehicle tracking, maintenance scheduling, fuel management, and driver compliance

**ERP Integration Layer**
- Runtime: .NET / WCF (SOAP/XML middleware)
- No dedicated database — stateless middleware that translates between SAP ECC protocols and internal WCF services
- Deployment: On-premises IIS (Windows Server 2016), co-located with WMS for latency
- Repository: `acme-dist-erp-integration`
- CI: GitHub Actions — build + unit tests on push/PR
- Bridges SAP ECC (IDoc/BAPI/RFC) with internal systems via SOAP

**IoT Tracking Platform**
- Runtime: Node.js 18, Express web framework
- Database: InfluxDB 2 (time-series) on Azure VM; Mosquitto MQTT broker on Azure VM
- Deployment: AKS — 3 replicas, 2 vCPU / 8 GB each (higher memory for MQTT message processing)
- Repository: `acme-dist-iot-platform`
- CI: GitHub Actions — build + unit tests + ESLint on push/PR
- Ingests telemetry from ~2,350 devices (sensors + GPS trackers)

**Driver Mobile App**
- Runtime: Xamarin (legacy — approaching end-of-life)
- Database: SQLite (local on-device) with REST sync to WMS and Route Optimization
- Distribution: Android and iOS app stores (enterprise distribution)
- Repository: `acme-dist-driver-app`
- CI: GitHub Actions — build on push/PR (limited — Xamarin builds require specific agents)
- Provides delivery confirmations, route navigation (HERE Maps deep links), and proof-of-delivery capture

## Post-Migration Status

Acme Distribution completed its migration from Azure DevOps to GitHub approximately 6 months ago. The migration covered source code repositories, partial work item history (converted to GitHub Issues), and build definitions (converted to GitHub Actions workflows).

### What Is Working

- **Source code:** All 6 system repositories have been migrated to GitHub under the `epam-acme-bookstore-demo-org` organization
- **GitHub Actions CI:** All 6 systems have basic CI pipelines running on push and PR events. Build definitions are in `.github/workflows/ci.yml` for each repository. Pipelines perform build and unit test execution as a baseline.
- **Issue tracking:** Work items have been partially migrated to GitHub Issues. New work is tracked in GitHub Issues.
- **Pull requests:** Teams are using GitHub pull requests for code review, though the process is not yet enforced by branch protection rules.

### What Is Not Yet Configured

- **GitHub Advanced Security (GHAS):** Not enabled. No code scanning, no secret scanning, no dependency review configured across any repository. This is on the Platform team's roadmap but has not been prioritized.
- **Branch protection rules:** Not yet configured on most repositories. The Platform team has this on their backlog but it hasn't been actioned. Currently, any team member can push directly to `main`.
- **CD pipelines:** No continuous deployment pipelines exist in GitHub Actions. Deployments to production remain semi-manual — scripts are run from jump boxes by the Platform team or system leads.
- **Required reviews:** Pull request reviews are encouraged but not required by branch rules. The teams follow an informal review process.
- **Code owners:** `CODEOWNERS` files have not been set up in any repository.

> _"We're still getting used to GitHub. The migration went smoothly but we haven't had time to set up branch protection, required reviews, or advanced security features. The teams are focused on keeping the lights on."_ — Platform Team Lead

### Remnant Azure DevOps References

The following ADO artifacts and references may still be encountered across Acme Distribution repositories. These should be treated as outdated:

- Some README files still contain Azure DevOps badge URLs (e.g., `https://dev.azure.com/acme-dist/.../_apis/build/status/...`)
- Build scripts in some repositories may reference ADO variables such as `$(Build.SourcesDirectory)` or `$(Build.BuildId)` — these are non-functional in GitHub Actions and should be updated
- Commit messages in repository history use the ADO work item format (`AB#12345`) rather than GitHub Issues (`#123`)
- Wiki content from Azure DevOps was exported as Markdown files but has not yet been organized or published in GitHub. These files are scattered across repository `docs/` folders.
- Some inline code comments reference ADO pipeline stages by name (e.g., `// Triggered by ADO Release Pipeline Stage 2`) — these are no longer applicable

> **Important:** If you encounter Azure DevOps references in any Acme Distribution repository, please flag them for the Platform Team to update. The canonical source for CI/CD is GitHub Actions, and work tracking is done in GitHub Issues.

## Third-Party System Inventory

Acme Distribution integrates with several external systems and vendor platforms:

| System | Vendor | Integration Type | Purpose | Criticality |
|--------|--------|-----------------|---------|-------------|
| SAP ECC | SAP | IDoc / BAPI / RFC | Master data source — products, customers, pricing | Critical |
| HERE Maps | HERE Technologies | REST API | Route calculation, distance matrices, ETA estimation | High |
| Twilio | Twilio | REST API | Driver and customer SMS notifications | Medium |
| DHL | DHL | REST API + Webhook | Shipping label generation, package tracking | High |
| FedEx | FedEx | REST API + Webhook | Shipping label generation, package tracking | High |

### SAP ECC Integration Detail

SAP ECC is the enterprise master data source for products, customers, and pricing across the Acme Corp group. For Acme Distribution, SAP integration is critical to warehouse operations:

- **Integration protocols:** IDoc interfaces (DESADV for ASNs, WMMBXY for goods movements, MATMAS for product master, DEBMAS for customer master) and BAPI calls (BAPI_GOODSMVT_CREATE for goods receipt and goods issue)
- **Middleware:** SAP PI (Process Integration) manages all message routing between SAP ECC and Acme Distribution systems
- **Connection:** RFC (Remote Function Call) destinations configured between SAP and the ERP Integration Layer
- **Data sync frequency:**
  - Product and customer master data: near real-time via IDocs (typically 2–5 minutes from SAP change)
  - Pricing data: nightly batch extract
- **Known issue:** 15-minute lag in master data sync during peak periods due to SAP PI queue depth. The nightly reconciliation batch catches discrepancies but intraday mismatches can affect order processing.

## Technical Debt Inventory

| Item | System | Severity | Detail | Planned Remediation |
|------|--------|----------|--------|---------------------|
| .NET Framework 4.6 | WMS | High | .NET Framework 4.6 is out of mainstream support. No security patches available. | Migration to .NET 8 planned but not yet started. Estimated 12–18 month effort. |
| Xamarin EOL | Driver Mobile App | High | Xamarin end-of-life is approaching. .NET MAUI is the successor but requires significant rework. | Evaluating .NET MAUI vs. React Native. Decision pending. |
| SOAP/XML integration | ERP Integration Layer | Medium | All internal consumers must use SOAP/XML to interact with SAP. No REST API available for SAP data. | REST facade being built incrementally on WMS (per ADR-001). |
| Java 11 | Fleet Management | Medium | Java 11 is approaching internal EOL policy (LTS support timeline). | Upgrade to Java 17 planned but not yet scheduled. |
| SQL Server 2016 | WMS | Medium | SQL Server 2016 mainstream support ended. Extended support until 2026. | Upgrade to SQL Server 2022 tied to WMS .NET migration. |
| Single MQTT broker | IoT Tracking Platform | Medium | Mosquitto MQTT broker is a single instance with no high-availability configuration. | HA cluster deployment planned for Q3. |

These items are tracked and acknowledged by the engineering teams. Remediation is planned but constrained by team capacity and the priority of keeping production systems operational during and after the GitHub migration.

## Team Structure

| Team | Size | Responsibilities | Key Systems |
|------|------|-----------------|-------------|
| WMS Team | 15 developers | Warehouse Management System, ERP Integration Layer, REST facade development | WMS, ERP Integration |
| Logistics Team | 8 developers | Route Optimisation Service, Driver Mobile App | Route Optimization, Driver App |
| Fleet/IoT Team | 10 developers | Fleet Management, IoT Tracking Platform | Fleet Management, IoT Platform |
| Platform Team | 5 engineers | Infrastructure, CI/CD, GitHub administration, cloud (AKS) | Cross-cutting |

All teams are based in Dallas, TX with some remote members. The Platform Team manages the GitHub organization, AKS infrastructure, and is responsible for the ongoing migration hardening (branch protection, GHAS enablement, CD pipeline automation).

Teams follow a two-week sprint cadence with planning aligned to the broader Acme Distribution quarterly business objectives. Cross-team coordination happens through a weekly technical leads meeting.

## Related Documentation

- **Business overview:** See [Acme Distribution Business Overview](../business/overview.md)
- **Architecture:** See [Architecture Overview](../architecture/overview.md) for system interactions and deployment topology
- **Individual system deep-dives:** See [WMS](wms.md), [Route Optimization](route-optimization.md), [Fleet Management](fleet-management.md), [IoT Tracking](iot-tracking.md)
