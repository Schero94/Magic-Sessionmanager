import assert from 'node:assert/strict';
import zlib from 'node:zlib';
import test from 'node:test';

import {
  buildBasicAuthHeader,
  buildDownloadUrl,
  extractMmdbFromTarGz,
  needsDownload,
  resolveConfig,
} from '../scripts/update-geoip-db.mjs';

function createTarGz(entries) {
  const blocks = [];

  for (const entry of entries) {
    const nameBuffer = Buffer.from(entry.name);
    const body = Buffer.from(entry.body);
    const header = Buffer.alloc(512, 0);

    nameBuffer.copy(header, 0, 0, Math.min(nameBuffer.length, 100));
    Buffer.from('0000644\0').copy(header, 100);
    Buffer.from('0000000\0').copy(header, 108);
    Buffer.from('0000000\0').copy(header, 116);
    Buffer.from(body.length.toString(8).padStart(11, '0') + '\0').copy(header, 124);
    Buffer.from(Math.floor(Date.now() / 1000).toString(8).padStart(11, '0') + '\0').copy(header, 136);
    Buffer.from('        ').copy(header, 148);
    Buffer.from('0').copy(header, 156);
    Buffer.from('ustar\0').copy(header, 257);
    Buffer.from('00').copy(header, 263);

    let checksum = 0;
    for (const byte of header) checksum += byte;
    Buffer.from(checksum.toString(8).padStart(6, '0') + '\0 ').copy(header, 148);

    blocks.push(header, body);

    const padding = (512 - (body.length % 512)) % 512;
    if (padding > 0) {
      blocks.push(Buffer.alloc(padding, 0));
    }
  }

  blocks.push(Buffer.alloc(1024, 0));
  return zlib.gzipSync(Buffer.concat(blocks));
}

test('buildDownloadUrl creates the MaxMind GeoLite2 Country permalink', () => {
  assert.equal(
    buildDownloadUrl('GeoLite2-Country'),
    'https://download.maxmind.com/geoip/databases/GeoLite2-Country/download?suffix=tar.gz'
  );
});

test('buildDownloadUrl creates the MaxMind GeoLite2 City permalink', () => {
  assert.equal(
    buildDownloadUrl('GeoLite2-City'),
    'https://download.maxmind.com/geoip/databases/GeoLite2-City/download?suffix=tar.gz'
  );
});

test('buildBasicAuthHeader encodes account id and license key', () => {
  assert.equal(
    buildBasicAuthHeader('12345', 'secret-key'),
    `Basic ${Buffer.from('12345:secret-key').toString('base64')}`
  );
});

test('resolveConfig reads credentials and output path from env', () => {
  const config = resolveConfig({
    MAXMIND_ACCOUNT_ID: '12345',
    MAXMIND_LICENSE_KEY: 'license',
    MAGIC_SESSIONMANAGER_GEOIP_DATABASE: '/tmp/GeoLite2-Country.mmdb',
  });

  assert.equal(config.accountId, '12345');
  assert.equal(config.licenseKey, 'license');
  assert.equal(config.editionId, 'GeoLite2-Country');
  assert.equal(config.outputPath, '/tmp/GeoLite2-Country.mmdb');
});

test('resolveConfig defaults to GeoLite2 City database', () => {
  const config = resolveConfig({
    MAXMIND_ACCOUNT_ID: '12345',
    MAXMIND_LICENSE_KEY: 'license',
  });

  assert.equal(config.editionId, 'GeoLite2-City');
  assert.match(config.outputPath, /GeoLite2-City\.mmdb$/);
  assert.equal(config.mmdbFileName, 'GeoLite2-City.mmdb');
});

test('needsDownload skips when local metadata matches remote Last-Modified', () => {
  assert.equal(
    needsDownload({
      force: false,
      localExists: true,
      localMetadata: { lastModified: 'Sat, 20 Jun 2026 00:00:00 GMT' },
      remoteLastModified: 'Sat, 20 Jun 2026 00:00:00 GMT',
    }),
    false
  );
});

test('extractMmdbFromTarGz returns the MMDB file from a MaxMind archive', async () => {
  const archive = createTarGz([
    { name: 'GeoLite2-Country_20260620/COPYRIGHT.txt', body: 'copyright' },
    { name: 'GeoLite2-Country_20260620/GeoLite2-Country.mmdb', body: 'fake-mmdb-content' },
  ]);

  const extracted = await extractMmdbFromTarGz(archive, 'GeoLite2-Country.mmdb');

  assert.equal(extracted.name, 'GeoLite2-Country_20260620/GeoLite2-Country.mmdb');
  assert.equal(extracted.data.toString(), 'fake-mmdb-content');
});

test('extractMmdbFromTarGz returns the City MMDB file from a MaxMind archive', async () => {
  const archive = createTarGz([
    { name: 'GeoLite2-City_20260709/COPYRIGHT.txt', body: 'copyright' },
    { name: 'GeoLite2-City_20260709/GeoLite2-City.mmdb', body: 'fake-city-mmdb-content' },
  ]);

  const extracted = await extractMmdbFromTarGz(archive, 'GeoLite2-City.mmdb');

  assert.equal(extracted.name, 'GeoLite2-City_20260709/GeoLite2-City.mmdb');
  assert.equal(extracted.data.toString(), 'fake-city-mmdb-content');
});
