'use strict';

const fs = require('node:fs/promises');
const crypto = require('node:crypto');
const path = require('node:path');
const process = require('node:process');
const zlib = require('node:zlib');
const { promisify } = require('node:util');

const gunzip = promisify(zlib.gunzip);

const DEFAULT_EDITION_ID = 'GeoLite2-City';
const DEFAULT_MMDB_NAME = `${DEFAULT_EDITION_ID}.mmdb`;
const DEFAULT_GEOIP_DIRECTORY = path.resolve(process.cwd(), 'data', 'magic-sessionmanager', 'geoip');
const DEFAULT_OUTPUT_PATH = path.join(DEFAULT_GEOIP_DIRECTORY, DEFAULT_MMDB_NAME);
const SUPPORTED_EDITION_IDS = new Set([
  'GeoLite2-City',
  'GeoLite2-Country',
  'GeoIP2-City',
  'GeoIP2-Country',
]);
const SUPPORTED_MMDB_NAMES = new Set([...SUPPORTED_EDITION_IDS].map((editionId) => `${editionId}.mmdb`));

/**
 * Resolves a supported MMDB filename into the plugin's dedicated database
 * directory. Absolute paths are accepted only when they already target that
 * exact directory; nested paths, traversal and other directories are rejected.
 *
 * @param {string} [value] Filename or canonical path to an MMDB file
 * @param {string} [directory] Dedicated database directory
 * @returns {string} Lexically resolved MMDB destination
 * @throws {Error} When the destination escapes the dedicated directory
 */
function resolveDatabaseTarget(value, directory = DEFAULT_GEOIP_DIRECTORY) {
  const root = path.resolve(directory);
  if (value !== undefined && typeof value !== 'string') {
    throw new Error('GeoIP database path must be a string');
  }
  const requested = typeof value === 'string' && value.trim() ? value.trim() : DEFAULT_MMDB_NAME;
  let filename;

  if (path.isAbsolute(requested)) {
    const absolute = path.resolve(requested);
    if (path.dirname(absolute) !== root) {
      throw new Error('GeoIP database path must stay inside the dedicated GeoIP directory');
    }
    filename = path.basename(absolute);
  } else {
    if (path.basename(requested) !== requested || requested === '.' || requested === '..') {
      throw new Error('GeoIP database path must stay inside the dedicated GeoIP directory');
    }
    filename = requested;
  }

  if (!SUPPORTED_MMDB_NAMES.has(filename)) {
    throw new Error('GeoIP database path must use a supported MMDB filename');
  }

  return path.join(root, filename);
}

/**
 * Creates and canonicalizes the dedicated GeoIP directory, then rejects
 * symlinked directories, database files or metadata sidecars before a provider
 * request occurs.
 *
 * @param {string} [value] Filename or canonical path to an MMDB file
 * @param {string} [directory] Dedicated database directory
 * @returns {Promise<string>} Canonical MMDB destination
 * @throws {Error} When the directory, database or sidecar is unsafe
 */
async function canonicalizeDatabaseTarget(value, directory = DEFAULT_GEOIP_DIRECTORY) {
  const root = path.resolve(directory);
  const target = resolveDatabaseTarget(value, root);
  await fs.mkdir(root, { recursive: true, mode: 0o700 });

  const rootStat = await fs.lstat(root);
  const canonicalRoot = await fs.realpath(root);
  if (rootStat.isSymbolicLink()) {
    throw new Error('GeoIP database directory must not be a symlink');
  }
  const canonicalTarget = path.join(canonicalRoot, path.basename(target));

  for (const candidate of [canonicalTarget, `${canonicalTarget}.metadata.json`]) {
    try {
      const stat = await fs.lstat(candidate);
      if (stat.isSymbolicLink()) {
        throw new Error('GeoIP database destination must not be a symlink');
      }
      if (!stat.isFile()) {
        throw new Error('GeoIP database destination must be a regular file');
      }
      if (path.dirname(await fs.realpath(candidate)) !== canonicalRoot) {
        throw new Error('GeoIP database destination is outside the canonical directory');
      }
    } catch (error) {
      if (error.code !== 'ENOENT') throw error;
    }
  }

  return canonicalTarget;
}

/**
 * Selects a supported MaxMind edition or uses the configured safe default.
 *
 * @param {string} value Requested edition identifier
 * @param {string} [fallback=DEFAULT_EDITION_ID] Fallback edition
 * @returns {string} Supported edition identifier
 */
function normalizeEditionId(value, fallback = DEFAULT_EDITION_ID) {
  return SUPPORTED_EDITION_IDS.has(value) ? value : fallback;
}

/**
 * Infers the MaxMind edition from a database filename.
 *
 * @param {string} filePath Candidate MMDB path
 * @returns {string} Supported edition identifier, or an empty string
 */
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

/**
 * Builds the fixed MaxMind download endpoint for a supported edition.
 *
 * @param {string} [editionId=DEFAULT_EDITION_ID] MaxMind edition
 * @returns {string} MaxMind archive URL
 */
function buildDownloadUrl(editionId = DEFAULT_EDITION_ID) {
  return `https://download.maxmind.com/geoip/databases/${encodeURIComponent(editionId)}/download?suffix=tar.gz`;
}

/**
 * Encodes MaxMind credentials for the updater request header.
 *
 * @param {string} accountId MaxMind account identifier
 * @param {string} licenseKey MaxMind license key
 * @returns {string} Basic authorization header value
 */
function buildBasicAuthHeader(accountId, licenseKey) {
  return `Basic ${Buffer.from(`${accountId}:${licenseKey}`).toString('base64')}`;
}

/**
 * Builds updater configuration and confines its output to the GeoIP directory.
 *
 * @param {NodeJS.ProcessEnv} [env=process.env] Environment values
 * @param {string[]} [argv=process.argv.slice(2)] CLI arguments
 * @param {object} [overrides] Explicit test or caller overrides
 * @returns {object} Validated updater configuration
 * @throws {Error} When a requested output path escapes its dedicated directory
 */
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
  const databaseDirectory = overrides.databaseDirectory || DEFAULT_GEOIP_DIRECTORY;
  const outputPath = resolveDatabaseTarget(
    configuredOutputPath || `${editionId}.mmdb`,
    databaseDirectory
  );

  return {
    accountId: overrides.accountId || env.MAXMIND_ACCOUNT_ID || env.MAXMIND_USER_ID || '',
    licenseKey: overrides.licenseKey || env.MAXMIND_LICENSE_KEY || '',
    editionId,
    outputPath,
    mmdbFileName: `${editionId}.mmdb`,
    force,
  };
}

/**
 * Decides whether the local database differs from the remote edition.
 *
 * @param {object} options Comparison inputs and force flag
 * @returns {boolean} Whether the updater should fetch a fresh archive
 */
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

/**
 * Extracts only the requested regular MMDB file from a MaxMind tar.gz archive.
 *
 * @param {Buffer} archiveBuffer Compressed archive bytes
 * @param {string} [preferredFileName=DEFAULT_MMDB_NAME] Expected database file
 * @returns {Promise<{name: string, data: Buffer}>} Archive entry and contents
 * @throws {Error} When the expected regular file is absent
 */
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

/**
 * Reads a null-terminated UTF-8 value from a fixed-width tar header field.
 *
 * @param {Buffer} buffer Tar header bytes
 * @param {number} start Field offset
 * @param {number} length Field width
 * @returns {string} Decoded header field
 */
function readTarString(buffer, start, length) {
  const slice = buffer.subarray(start, start + length);
  const nullIndex = slice.indexOf(0);
  return slice.subarray(0, nullIndex === -1 ? slice.length : nullIndex).toString('utf8');
}

/**
 * Reads updater metadata, returning null for missing or invalid JSON files.
 *
 * @param {string} metadataPath Canonical sidecar file path
 * @returns {Promise<object|null>} Parsed metadata or null
 */
async function readMetadata(metadataPath) {
  try {
    return JSON.parse(await fs.readFile(metadataPath, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Checks whether a database file can be accessed.
 *
 * @param {string} filePath Canonical database file path
 * @returns {Promise<boolean>} Whether the file exists and is accessible
 */
async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/**
 * Requests remote edition metadata from the fixed MaxMind provider.
 *
 * @param {string} url MaxMind edition URL
 * @param {string} authHeader Authorization value
 * @returns {Promise<{lastModified: string, contentDisposition: string}>}
 * @sideeffect Sends an authenticated HEAD request to MaxMind
 */
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

/**
 * Downloads a MaxMind archive for the selected edition.
 *
 * @param {string} url MaxMind edition URL
 * @param {string} authHeader Authorization value
 * @returns {Promise<Buffer>} Archive bytes
 * @sideeffect Sends an authenticated GET request to MaxMind
 */
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

/**
 * Writes a new file through a unique, exclusive temporary file and atomic rename.
 *
 * @param {string} outputPath Canonical destination inside the GeoIP directory
 * @param {Buffer|string} data Database or metadata contents
 * @returns {Promise<void>}
 * @sideeffect Creates and renames files in the destination directory
 */
async function writeAtomic(outputPath, data) {
  const directory = path.dirname(outputPath);
  const tempPath = path.join(directory, `.${path.basename(outputPath)}.${crypto.randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(tempPath, 'wx', 0o600);
    await handle.writeFile(data);
    await handle.sync();
  } catch (error) {
    await handle?.close().catch(() => {});
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  try {
    await handle.close();
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }

  try {
    await fs.rename(tempPath, outputPath);
  } catch (error) {
    await fs.rm(tempPath, { force: true }).catch(() => {});
    throw error;
  }
}

/**
 * Downloads, validates and atomically installs a MaxMind MMDB edition.
 * Destination validation happens before the first provider request.
 *
 * @param {object} [config=resolveConfig()] Credentials, edition and destination
 * @returns {Promise<object>} Safe update result with the installed file path
 * @sideeffect Contacts MaxMind and writes the MMDB plus metadata sidecar
 * @throws {Error} When credentials, destination, archive or provider fail
 */
async function updateGeoIpDatabase(config = resolveConfig()) {
  if (!config.accountId || !config.licenseKey) {
    throw new Error('MAXMIND_ACCOUNT_ID and MAXMIND_LICENSE_KEY are required');
  }

  const editionId = normalizeEditionId(config.editionId);
  const outputPath = await canonicalizeDatabaseTarget(config.outputPath);
  const mmdbFileName = `${editionId}.mmdb`;
  if (path.basename(outputPath) !== mmdbFileName) {
    throw new Error('GeoIP database filename must match the selected edition');
  }

  const url = buildDownloadUrl(editionId);
  const authHeader = buildBasicAuthHeader(config.accountId, config.licenseKey);
  const metadataPath = `${outputPath}.metadata.json`;

  const [head, localMetadata, localExists] = await Promise.all([
    fetchHead(url, authHeader),
    readMetadata(metadataPath),
    fileExists(outputPath),
  ]);

  if (!needsDownload({
    force: config.force,
    localExists,
    localMetadata,
    remoteLastModified: head.lastModified,
  })) {
    return {
      changed: false,
      outputPath,
      lastModified: head.lastModified,
      message: 'GeoIP database is already current',
    };
  }

  const archive = await fetchArchive(url, authHeader);
  const extracted = await extractMmdbFromTarGz(archive, mmdbFileName);

  await writeAtomic(outputPath, extracted.data);
  await writeAtomic(metadataPath, JSON.stringify({
    editionId,
    sourceFile: extracted.name,
    lastModified: head.lastModified,
    downloadedAt: new Date().toISOString(),
    sourceUrl: url,
  }, null, 2));

  return {
    changed: true,
    outputPath,
    sourceFile: extracted.name,
    lastModified: head.lastModified,
    message: 'GeoIP database updated',
  };
}

module.exports = {
  DEFAULT_EDITION_ID,
  DEFAULT_GEOIP_DIRECTORY,
  DEFAULT_MMDB_NAME,
  DEFAULT_OUTPUT_PATH,
  buildBasicAuthHeader,
  buildDownloadUrl,
  canonicalizeDatabaseTarget,
  extractMmdbFromTarGz,
  fileExists,
  inferEditionIdFromPath,
  needsDownload,
  readMetadata,
  resolveDatabaseTarget,
  resolveConfig,
  updateGeoIpDatabase,
};
