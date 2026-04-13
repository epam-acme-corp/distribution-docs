// @ts-check
import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://epam-acme-corp.github.io',
  base: '/distribution-docs',
  integrations: [
    starlight({
      title: 'Acme Distribution',
      social: {
        github: 'https://github.com/epam-acme-corp/distribution-docs',
      },
      components: {
        SiteTitle: './src/components/OPCOSelector.astro',
      },
      sidebar: [
        {
          label: 'Overview',
          items: [
            { label: 'Business Overview', slug: 'business/overview' },
          ],
        },
        {
          label: 'Architecture',
          items: [
            { label: 'Architecture Overview', slug: 'architecture/overview' },
            {
              label: 'ADR',
              items: [
                { label: 'ADR-001: SAP Integration Pattern', slug: 'architecture/adr/adr-001-sap-integration-pattern' },
              ],
            },
          ],
        },
        {
          label: 'Technical',
          items: [
            { label: 'System Landscape', slug: 'technical/system-landscape' },
            { label: 'Fleet Management', slug: 'technical/fleet-management' },
            { label: 'IoT Tracking', slug: 'technical/iot-tracking' },
            { label: 'Route Optimisation', slug: 'technical/route-optimization' },
            { label: 'WMS Deep-Dive', slug: 'technical/wms' },
          ],
        },
        {
          label: 'API',
          items: [
            { label: 'API Overview', slug: 'api/overview' },
            { label: 'Integration Specifications', slug: 'api/integration-specs' },
            { label: 'WMS API Contracts', slug: 'api/wms-api' },
          ],
        },
        {
          label: 'Data',
          items: [
            { label: 'Data Architecture', slug: 'data/architecture' },
          ],
        },
        {
          label: 'Operations',
          items: [
            { label: 'Operations Overview', slug: 'operations/overview' },
          ],
        },
      ],
    }),
  ],
});
