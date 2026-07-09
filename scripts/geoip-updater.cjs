'use strict';

const fs = require('node:fs/promises');
const path = require('node:path');
const process = require('node:process');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const gunzip = promisify(zlib.gunzip);

const DEFAULT_EDITION_ID = 'GeoLite2-City';
const DEFAULT_MMDB_NAME = `${DEFAULT_EDITION_ID}.mmdb`;
const DEFAULT_OUTPUT_PATH = path.resolve(process.cwd(), 'data', DEFAULT_MMDB_NAME);
const SUPPORTED_EDITION_IDS = new Set([
  'GeoLite2-City',
  'GeoLite2-Country',
  'GeoIP2-City',
  'GeoIP2-Country',
]);

function normalizeEditionId(value, fallback = DEFAULT_EDITION_ID) {
  return SUPPORTED_EDITION_IDS.has(value) ? value : fallback;
}

function inferEditionIdFromPath(filePath) {
  if (typeof filePath !== 'string' || filePath.trim() === '') return '';

  const basename = path.basename(filePath.trim());
  if (/GeoIP2-City\.mmdb$/i.test(basename)) return 'GeoIP2-City';
  if (/GeoIP2-Country\.mmdb$/i.test(basename)) return 'GeoIP2-Country';
  if (/GeoLite2-City\.mmdb$/i.test(basename)) return 'GeoLite2-City';
  if (/GeoLite2-Country\.mmdb$/i.test(basename)) return 'GeoLite2-Country';
  if (/city/i.test(basename)) return 'GeoLite2-City';
  if (/country/i.test(basename)) return 'GeoLite2-Country';

  return '';
}

function buildDownloadUrl(editionId = DEFAULT_EDITION_ID) {
  return `https://download.maxmind.com/geoip/databases/${encodeURIComponent(editionId)}/download?suffix=tar.gz`;
}

function buildBasicAuthHeader(accountId, licenseKey) {
  return `Basic ${Buffer.from(`${accountId}:${licenseKey}`).toString('base64')}`;
}

function resolveConfig(env = process.env, argv = process.argv.slice(2), overrides = {}) {
  const force = argv.includes('--force') || overrides.force === true;
  const configuredOutputPath =
    overrides.outputPath ||
    env.MAGIC_SESSIONMANAGER_GEOIP_DATABASE ||
    env.GEOIP_DATABASE_PATH ||
    '';
  const editionId = normalizeEditionId(
    overrides.editionId ||
    env.MAXMIND_EDITION_ID ||
    inferEditionIdFromPath(configuredOutputPath) ||
    DEFAULT_EDITION_ID
  );
  const outputPath = configuredOutputPath || path.resolve(process.cwd(), 'data', `${editionId}.mmdb`);

  return {
    accountId: overrides.accountId || env.MAXMIND_ACCOUNT_ID || env.MAXMIND_USER_ID || '',
    licenseKey: overrides.licenseKey || env.MAXMIND_LICENSE_KEY || '',
    editionId,
    outputPath,
    mmdbFileName: `${editionId}.mmdb`,
    force,
  };
}

function needsDownload({
  force,
  localExists,
  localMetadata,
  remoteLastModified,
}) {
  if (force) return true;
  if (!localExists) return true;
  if (!remoteLastModified) return true;
  return localMetadata?.lastModified !== remoteLastModified;
}

async function extractMmdbFromTarGz(archiveBuffer, preferredFileName = DEFAULT_MMDB_NAME) {
  const tarBuffer = await gunzip(archiveBuffer);
  let offset = 0;

  while (offset + 512 <= tarBuffer.length) {
    const header = tarBuffer.subarray(offset, offset + 512);
    offset += 512;

    if (header.every((byte) => byte === 0)) {
      break;
    }

    const name = readTarString(header, 0, 100);
    const prefix = readTarString(header, 345, 155);
    const fullName = prefix ? `${prefix}/${name}` : name;
    const typeFlag = readTarString(header, 156, 1);
    const sizeOctal = readTarString(header, 124, 12).replace(/\0/g, '').trim();
    const size = Number.parseInt(sizeOctal || '0', 8);
    const data = tarBuffer.subarray(offset, offset + size);

    const normalizedName = fullName.replace(/\\/g, '/');
    const isRegularFile = typeFlag === '' || typeFlag === '0';
    if (
      isRegularFile &&
      normalizedName.endsWith('.mmdb') &&
      path.posix.basename(normalizedName) === preferredFileName
    ) {
      return {
        name: normalizedName,
        data: Buffer.from(data),
      };
    }

    offset += Math.ceil(size / 512) * 512;
  }

  throw new Error(`No ${preferredFileName} file found in MaxMind archive`);
}

function readTarString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const nullIndex = slice.indexOf(0);
  return slice.subarray(0, nullIndex === -1 ? slice.length : nullIndex).toString('utf8');
}

async function readMetadata(metadataPath) {
  try {
    return JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch {
    return null;
  }
}

async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function fetchHead(url, authHeader) {
  const response = await fetch(url, {
    method: 'HEAD',
    headers: {
      Authorization: authHeader,
      'User-Agent': 'Strapi-Magic-SessionManager-GeoIP-Updater/1.0',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`MaxMind HEAD failed with HTTP ${response.status}`);
  }

  return {
    lastModified: response.headers.get('last-modified') || '',
    contentDisposition: response.headers.get('content-disposition') || '',
  };
}

async function fetchArchive(url, authHeader) {
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      Authorization: authHeader,
      'User-Agent': 'Strapi-Magic-SessionManager-GeoIP-Updater/1.0',
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    throw new Error(`MaxMind download failed with HTTP ${response.status}`);
  }

  return Buffer.from(await response.arrayBuffer());
}

async function writeAtomic(outputPath, data) {
  const directory = path.dirname(outputPath);
  await fs.mkdir(directory, { recursive: true });

  const tempPath = `${outputPath}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tempPath, data);
  await fs.rename(tempPath, outputPath);
}

async function updateGeoIpDatabase(config = resolveConfig()) {
  if (!config.accountId || !config.licenseKey) {
    throw new Error('MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY are required');
  }

  const url = buildDownloadUrl(config.editionId);
  const authHeader = buildBasicAuthHeader(config.accountId, config.licenseKey);
  const metadataPath = `${config.outputPath}.metadata.json`;

  const [head, localMetadata, localExists] = await Promise.all([
    fetchHead(url, authHeader),
    readMetadata(metadataPath),
    fileExists(config.outputPath),
  ]);

  if (!needsDownload({
    force: config.force,
    localExists,
    localMetadata,
    remoteLastModified: head.lastModified,
  })) {
    return {
      changed: false,
      outputPath: config.outputPath,
      lastModified: head.lastModified,
      message: 'GeoIP database is already current',
    };
  }

  const archive = await fetchArchive(url, authHeader);
  const extracted = await extractMmdbFromTarGz(archive, config.mmdbFileName);

  await writeAtomic(config.outputPath, extracted.data);
  await fs.writeFile(metadataPath, JSON.stringify({
    editionId: config.editionId,
    sourceFile: extracted.name,
    lastModified: head.lastModified,
    downloadedAt: new Date().toISOString(),
    sourceUrl: url,
  }, null, 2));

  return {
    changed: true,
    outputPath: config.outputPath,
    sourceFile: extracted.name,
    lastModified: head.lastModified,
    message: 'GeoIP database updated',
  };
}

module.exports = {
  DEFAULT_EDITION_ID,
  DEFAULT_MMDB_NAME,
  DEFAULT_OUTPUT_PATH,
  buildBasicAuthHeader,
  buildDownloadUrl,
  extractMmdbFromTarGz,
  fileExists,
  inferEditionIdFromPath,
  needsDownload,
  readMetadata,
  resolveConfig,
  updateGeoIpDatabase,
};
