/**
 * Connection presets for S3-compatible object storage.
 *
 * Every provider speaks the same S3 API, so one driver covers them all. What
 * differs is the endpoint shape, the public URL shape, whether the region is a
 * fixed list, and whether per-object ACLs exist. A preset fills all of that in
 * so the admin only pastes a bucket name and a key pair.
 *
 * Templates use {region}, {bucket} and {account}. They are read on the server
 * and shipped to the browser as JSON so the connect form can fill itself in
 * while the admin types.
 */

const PROVIDERS = [
  {
    id: 'hetzner',
    site: 'https://www.hetzner.com',
    label: 'Hetzner',
    product: 'Object Storage',
    blurb: 'European buckets, low egress cost.',
    endpoint: 'https://{region}.your-objectstorage.com',
    publicUrl: 'https://{bucket}.{region}.your-objectstorage.com',
    forcePathStyle: false,
    supportsAcl: true,
    regionLabel: 'Location',
    regions: [
      { id: 'fsn1', label: 'Falkenstein, Germany' },
      { id: 'nbg1', label: 'Nuremberg, Germany' },
      { id: 'hel1', label: 'Helsinki, Finland' },
    ],
    credsHelp: 'Hetzner Cloud console → Object Storage → your bucket → Credentials → Generate credentials.',
    publicHelp: 'Set the bucket to public in the Hetzner console so the generated images can be served.',
  },
  {
    id: 'digitalocean',
    site: 'https://www.digitalocean.com',
    label: 'DigitalOcean',
    product: 'Spaces',
    blurb: 'Spaces with the built-in CDN edge.',
    endpoint: 'https://{region}.digitaloceanspaces.com',
    publicUrl: 'https://{bucket}.{region}.cdn.digitaloceanspaces.com',
    // Spaces ignores the region but the SDK requires one
    sdkRegion: 'us-east-1',
    forcePathStyle: false,
    supportsAcl: true,
    regionLabel: 'Datacenter',
    regions: [
      { id: 'fra1', label: 'Frankfurt' },
      { id: 'ams3', label: 'Amsterdam' },
      { id: 'lon1', label: 'London' },
      { id: 'nyc3', label: 'New York' },
      { id: 'sfo3', label: 'San Francisco' },
      { id: 'tor1', label: 'Toronto' },
      { id: 'sgp1', label: 'Singapore' },
      { id: 'blr1', label: 'Bangalore' },
      { id: 'syd1', label: 'Sydney' },
    ],
    credsHelp: 'DigitalOcean → API → Spaces keys → Generate new key.',
    publicHelp: 'Enable the CDN on the Space to use the cdn. hostname above. Without it, drop "cdn." from the URL.',
  },
  {
    id: 'aws',
    site: 'https://aws.amazon.com',
    label: 'Amazon',
    product: 'S3',
    blurb: 'The original. Pair it with CloudFront if you want.',
    endpoint: '',
    publicUrl: 'https://{bucket}.s3.{region}.amazonaws.com',
    forcePathStyle: false,
    supportsAcl: true,
    regionLabel: 'Region',
    regions: [
      { id: 'us-east-1', label: 'N. Virginia' },
      { id: 'us-east-2', label: 'Ohio' },
      { id: 'us-west-1', label: 'N. California' },
      { id: 'us-west-2', label: 'Oregon' },
      { id: 'eu-west-1', label: 'Ireland' },
      { id: 'eu-west-2', label: 'London' },
      { id: 'eu-west-3', label: 'Paris' },
      { id: 'eu-central-1', label: 'Frankfurt' },
      { id: 'eu-north-1', label: 'Stockholm' },
      { id: 'eu-south-1', label: 'Milan' },
      { id: 'ca-central-1', label: 'Canada' },
      { id: 'sa-east-1', label: 'Sao Paulo' },
      { id: 'ap-south-1', label: 'Mumbai' },
      { id: 'ap-southeast-1', label: 'Singapore' },
      { id: 'ap-southeast-2', label: 'Sydney' },
      { id: 'ap-northeast-1', label: 'Tokyo' },
      { id: 'ap-northeast-2', label: 'Seoul' },
    ],
    credsHelp: 'AWS IAM → Users → Security credentials → Create access key. Allow s3:PutObject, s3:DeleteObject and s3:PutObjectAcl on the bucket.',
    publicHelp: 'Turn off "Block all public access" on the bucket, or put CloudFront in front and paste its domain as the public URL.',
  },
  {
    id: 'r2',
    site: 'https://www.cloudflare.com',
    label: 'Cloudflare',
    product: 'R2',
    blurb: 'No egress fees. Needs a public r2.dev or custom domain.',
    endpoint: 'https://{account}.r2.cloudflarestorage.com',
    publicUrl: '',
    sdkRegion: 'auto',
    forcePathStyle: false,
    // R2 rejects the x-amz-acl header; access is controlled per bucket
    supportsAcl: false,
    needsAccount: true,
    accountLabel: 'Account ID',
    accountHelp: 'The 32-character ID in the R2 overview page URL.',
    regionLabel: 'Region',
    regions: [{ id: 'auto', label: 'Automatic' }],
    regionFact: 'One global namespace',
    credsHelp: 'Cloudflare → R2 → Manage API tokens → Create token with Object Read & Write.',
    publicHelp: 'R2 buckets are private until you enable a public r2.dev URL or connect a custom domain. Paste that domain as the public URL.',
  },
  {
    id: 'backblaze',
    site: 'https://www.backblaze.com',
    label: 'Backblaze',
    product: 'B2',
    blurb: 'Cheapest per TB, free egress through Cloudflare.',
    endpoint: 'https://s3.{region}.backblazeb2.com',
    publicUrl: 'https://{bucket}.s3.{region}.backblazeb2.com',
    forcePathStyle: false,
    // B2 has no per-object ACLs; the bucket is public or private
    supportsAcl: false,
    regionLabel: 'Region',
    regions: [
      { id: 'eu-central-003', label: 'Amsterdam' },
      { id: 'us-west-000', label: 'US West 000' },
      { id: 'us-west-001', label: 'US West 001' },
      { id: 'us-west-002', label: 'US West 002' },
      { id: 'us-west-004', label: 'US West 004' },
      { id: 'us-east-005', label: 'US East 005' },
    ],
    credsHelp: 'Backblaze → Application Keys → Add a New Application Key. The keyID is the access key.',
    publicHelp: 'Set the bucket type to Public in Backblaze. The region is shown as the S3 endpoint on the bucket page.',
  },
  {
    id: 'wasabi',
    site: 'https://wasabi.com',
    label: 'Wasabi',
    product: 'Hot Cloud Storage',
    blurb: 'Flat pricing, no egress charges.',
    endpoint: 'https://s3.{region}.wasabisys.com',
    publicUrl: 'https://s3.{region}.wasabisys.com/{bucket}',
    forcePathStyle: true,
    supportsAcl: true,
    regionLabel: 'Region',
    regions: [
      { id: 'eu-central-1', label: 'Amsterdam' },
      { id: 'eu-central-2', label: 'Frankfurt' },
      { id: 'eu-west-1', label: 'London' },
      { id: 'eu-west-2', label: 'Paris' },
      { id: 'us-east-1', label: 'N. Virginia 1' },
      { id: 'us-east-2', label: 'N. Virginia 2' },
      { id: 'us-central-1', label: 'Texas' },
      { id: 'us-west-1', label: 'Oregon' },
      { id: 'ca-central-1', label: 'Toronto' },
      { id: 'ap-northeast-1', label: 'Tokyo' },
      { id: 'ap-southeast-1', label: 'Singapore' },
      { id: 'ap-southeast-2', label: 'Sydney' },
    ],
    credsHelp: 'Wasabi console → Access Keys → Create New Access Key.',
    publicHelp: 'Give the bucket a public read policy in the Wasabi console.',
  },
  {
    id: 'scaleway',
    site: 'https://www.scaleway.com',
    label: 'Scaleway',
    product: 'Object Storage',
    blurb: 'French provider, S3 compatible.',
    endpoint: 'https://s3.{region}.scw.cloud',
    publicUrl: 'https://{bucket}.s3.{region}.scw.cloud',
    forcePathStyle: false,
    supportsAcl: true,
    regionLabel: 'Region',
    regions: [
      { id: 'fr-par', label: 'Paris' },
      { id: 'nl-ams', label: 'Amsterdam' },
      { id: 'pl-waw', label: 'Warsaw' },
    ],
    credsHelp: 'Scaleway console → Identity and Access Management → API keys → Generate API key.',
    publicHelp: 'Set the bucket visibility to public, or the images return 403.',
  },
  {
    id: 'minio',
    site: 'https://min.io',
    label: 'MinIO',
    product: 'Self-hosted',
    blurb: 'Your own S3 server. Path-style URLs.',
    endpoint: '',
    publicUrl: '',
    sdkRegion: 'us-east-1',
    forcePathStyle: true,
    supportsAcl: true,
    customEndpoint: true,
    regionLabel: 'Region',
    regions: null,
    credsHelp: 'MinIO console → Access Keys → Create access key.',
    publicHelp: 'Give the bucket a public download policy, then paste the URL your images are served from.',
  },
  {
    id: 'custom',
    label: 'Other',
    product: 'S3-compatible',
    blurb: 'Any provider with an S3 API: Storj, iDrive e2, OVH, Linode, GCS.',
    endpoint: '',
    publicUrl: '',
    sdkRegion: 'us-east-1',
    forcePathStyle: true,
    supportsAcl: true,
    customEndpoint: true,
    regionLabel: 'Region',
    regions: null,
    credsHelp: 'Use the access key and secret your provider issues for its S3 API.',
    publicHelp: 'Paste the endpoint from your provider and the base URL the objects are served from.',
  },
];

const BY_ID = new Map(PROVIDERS.map((p) => [p.id, p]));

function get(id) {
  return BY_ID.get(String(id || '')) || null;
}

function fill(template, vars) {
  if (!template) return '';
  return template.replace(/\{(region|bucket|account)\}/g, (_, name) => vars[name] || '');
}

/** Endpoint, public URL and flags a preset derives from what the admin typed. */
function derive(providerId, { region, bucket, account, endpoint, publicUrl } = {}) {
  const preset = get(providerId);
  if (!preset) return null;
  const vars = { region: region || '', bucket: bucket || '', account: account || '' };
  return {
    provider: preset.id,
    endpoint: (preset.customEndpoint ? endpoint : fill(preset.endpoint, vars)) || '',
    publicUrl: (preset.publicUrl ? fill(preset.publicUrl, vars) : publicUrl) || publicUrl || '',
    region: vars.region || preset.sdkRegion || 'us-east-1',
    sdkRegion: preset.sdkRegion || vars.region || 'us-east-1',
    forcePathStyle: Boolean(preset.forcePathStyle),
    supportsAcl: preset.supportsAcl !== false,
  };
}

/** Trimmed-down catalog for the browser, so the form fills itself in. */
function clientCatalog() {
  return PROVIDERS.map((p) => ({
    id: p.id,
    label: p.label,
    product: p.product,
    endpoint: p.endpoint,
    publicUrl: p.publicUrl,
    regions: p.regions,
    regionLabel: p.regionLabel,
    forcePathStyle: Boolean(p.forcePathStyle),
    supportsAcl: p.supportsAcl !== false,
    needsAccount: Boolean(p.needsAccount),
    customEndpoint: Boolean(p.customEndpoint),
  }));
}

module.exports = { PROVIDERS, get, fill, derive, clientCatalog, IDS: PROVIDERS.map((p) => p.id) };
