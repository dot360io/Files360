import { defineConfig } from 'vitepress';

const site = 'https://files360.dev';
const description = 'Self-hosted upload API and media library. Images are optimized into the sizes you choose, documents are stored with a preview, and everything lands on your own S3-compatible bucket.';

// Read by search engines and by the crawlers that feed AI models
const jsonLd = {
  '@context': 'https://schema.org',
  '@type': 'SoftwareApplication',
  name: 'Files360',
  applicationCategory: 'DeveloperApplication',
  operatingSystem: 'Linux, macOS, Windows (Docker or Node.js 20+)',
  description,
  url: site,
  downloadUrl: 'https://github.com/dot360io/Files360',
  softwareHelp: `${site}/install`,
  license: 'https://www.gnu.org/licenses/agpl-3.0.html',
  isAccessibleForFree: true,
  offers: { '@type': 'Offer', price: '0', priceCurrency: 'USD' },
  author: { '@type': 'Organization', name: 'Dot360', url: 'https://dot360.io' },
  publisher: { '@type': 'Organization', name: 'Dot360', url: 'https://dot360.io' },
  keywords: 'cloudinary alternative, self-hosted, image optimization, digital asset management, s3, file upload api',
};

export default defineConfig({
  title: 'Files360',
  description,
  lang: 'en',
  cleanUrls: true,
  lastUpdated: true,
  // The integration template is source for the dashboard and api.md, not a page
  srcExclude: ['integration-template.md'],
  sitemap: { hostname: site },
  head: [
    ['meta', { property: 'og:type', content: 'website' }],
    ['meta', { property: 'og:title', content: 'Files360: upload API and media library on your own bucket' }],
    ['meta', { property: 'og:description', content: description }],
    ['meta', { property: 'og:url', content: site }],
    ['link', { rel: 'alternate', type: 'text/plain', href: '/llms.txt', title: 'llms.txt' }],
    ['script', { type: 'application/ld+json' }, JSON.stringify(jsonLd)],
  ],
  themeConfig: {
    nav: [
      { text: 'Install', link: '/install' },
      { text: 'API', link: '/api' },
      { text: 'Compare', link: '/comparison' },
      { text: 'Blog', link: '/blog/hostile-uploads' },
      { text: 'by Dot360', link: 'https://dot360.io' },
    ],
    sidebar: [
      {
        text: 'Guide',
        items: [
          { text: 'Install', link: '/install' },
          { text: 'Configure', link: '/configure' },
          { text: 'Storage providers', link: '/storage' },
          { text: 'Security', link: '/security' },
        ],
      },
      {
        text: 'Reference',
        items: [
          { text: 'API reference', link: '/api' },
          { text: 'AI agents', link: '/agents' },
        ],
      },
      {
        text: 'Switching',
        items: [
          { text: 'Compared with Cloudinary', link: '/comparison' },
          { text: 'Migrating from Cloudinary', link: '/migrating-from-cloudinary' },
        ],
      },
    ],
    socialLinks: [{ icon: 'github', link: 'https://github.com/dot360io/Files360' }],
    editLink: { pattern: 'https://github.com/dot360io/Files360/edit/main/docs/:path', text: 'Edit this page' },
    search: { provider: 'local' },
    footer: {
      message: 'Released under the AGPL-3.0 licence.',
      copyright: 'Built and maintained by <a href="https://dot360.io">Dot360</a>, a custom software studio.',
    },
  },
});
