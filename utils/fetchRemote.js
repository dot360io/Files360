const http = require('http');
const https = require('https');
const dns = require('dns');
const net = require('net');
const path = require('path');
const { HttpError } = require('./errors');

const blocked = () => new HttpError(400, 'blocked_url', 'The URL points to a private or reserved address');

const ipv4ToInt = (ip) => ip.split('.').reduce((acc, octet) => (acc << 8) + Number(octet), 0) >>> 0;

const V4_RANGES = [
  ['0.0.0.0', 8], ['10.0.0.0', 8], ['100.64.0.0', 10], ['127.0.0.0', 8],
  ['169.254.0.0', 16], ['172.16.0.0', 12], ['192.0.0.0', 24], ['192.168.0.0', 16],
  ['198.18.0.0', 15], ['224.0.0.0', 4], ['240.0.0.0', 4],
].map(([base, bits]) => [ipv4ToInt(base), bits]);

function isPrivateIp(ip) {
  if (net.isIPv4(ip)) {
    const n = ipv4ToInt(ip);
    return V4_RANGES.some(([base, bits]) => n >>> (32 - bits) === base >>> (32 - bits));
  }
  const v6 = ip.toLowerCase();
  const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(v6);
  if (mapped) return isPrivateIp(mapped[1]);
  return (
    v6 === '::' || v6 === '::1' || v6.startsWith('::ffff:') ||
    /^f[cd]/.test(v6) || /^fe[89ab]/.test(v6) || v6.startsWith('ff')
  );
}

// Validates the resolved address at connect time, which also protects against DNS rebinding
function safeLookup(hostname, options, callback) {
  if (typeof options === 'function') {
    callback = options;
    options = {};
  }
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) return callback(err);
    if (!addresses.length || addresses.some((a) => isPrivateIp(a.address))) return callback(blocked());
    if (options.all) return callback(null, addresses);
    return callback(null, addresses[0].address, addresses[0].family);
  });
}

function fetchRemote(rawUrl, maxBytes, redirectsLeft = 3) {
  let url;
  try {
    url = new URL(rawUrl);
  } catch {
    return Promise.reject(new HttpError(400, 'invalid_url', 'url is not a valid URL'));
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    return Promise.reject(new HttpError(400, 'invalid_url', 'Only http and https URLs are allowed'));
  }
  // Node skips the lookup function for IP literals, so check those directly
  const host = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(host) && isPrivateIp(host)) return Promise.reject(blocked());

  const tooLarge = () => new HttpError(413, 'file_too_large', `The remote file is larger than ${Math.round(maxBytes / 1048576)} MB`);

  return new Promise((resolve, reject) => {
    const lib = url.protocol === 'https:' ? https : http;
    const req = lib.get(
      url,
      {
        lookup: safeLookup,
        timeout: 10_000,
        headers: {
          'user-agent': 'Files360/1.0',
          accept: 'image/*,application/pdf,text/csv,application/vnd.openxmlformats-officedocument.*;q=0.9,*/*;q=0.5',
        },
      },
      (res) => {
        const { statusCode, headers } = res;

        if (statusCode >= 300 && statusCode < 400 && headers.location) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(new HttpError(400, 'too_many_redirects', 'The URL redirected too many times'));
            return;
          }
          resolve(fetchRemote(new URL(headers.location, url).toString(), maxBytes, redirectsLeft - 1));
          return;
        }
        if (statusCode !== 200) {
          res.resume();
          reject(new HttpError(400, 'fetch_failed', `The remote server answered with status ${statusCode}`));
          return;
        }
        if (Number(headers['content-length']) > maxBytes) {
          res.destroy();
          reject(tooLarge());
          return;
        }

        const chunks = [];
        let size = 0;
        res.on('data', (chunk) => {
          size += chunk.length;
          if (size > maxBytes) {
            res.destroy();
            reject(tooLarge());
          } else {
            chunks.push(chunk);
          }
        });
        res.on('end', () => {
          if (size > maxBytes) return;
          let filename = path.basename(url.pathname) || 'remote-image';
          try {
            filename = decodeURIComponent(filename);
          } catch {
            // keep the raw name
          }
          resolve({
            buffer: Buffer.concat(chunks),
            filename: filename.slice(0, 255),
            contentType: headers['content-type'] || '',
          });
        });
        res.on('error', () => reject(new HttpError(400, 'fetch_failed', 'The download was interrupted')));
      }
    );

    const hardTimeout = setTimeout(
      () => req.destroy(new HttpError(504, 'fetch_timeout', 'The remote server took too long')),
      30_000
    );
    req.on('close', () => clearTimeout(hardTimeout));
    req.on('timeout', () => req.destroy(new HttpError(504, 'fetch_timeout', 'The remote server took too long')));
    req.on('error', (err) => {
      reject(err instanceof HttpError ? err : new HttpError(400, 'fetch_failed', `Could not download the image (${err.code || err.message})`));
    });
  });
}

module.exports = { fetchRemote, isPrivateIp };
