'use strict';

/**
 * Local MaxMind risk databases: where they live, whether they are usable and
 * what they say about an address.
 *
 * - **GeoIP2 Anonymous IP** (paid MaxMind database, `reader.anonymousIP()`):
 *   `isAnonymous`, `isAnonymousVpn`, `isHostingProvider`, `isPublicProxy`,
 *   `isResidentialProxy`, `isTorExitNode`. An address that is not in the
 *   database belongs to no known anonymiser (AddressNotFoundError).
 * - **GeoLite2 ASN** (free, `reader.asn()`): the network's autonomous system.
 *   Used only as a *heuristic* for hosting and cloud networks, from a short
 *   list of well-known provider ASNs. It never detects VPNs, proxies or Tor.
 *
 * Lookups are local; no address leaves the server. Docs: installed
 * `@maxmind/geoip2-node` 7.1 README and types (`anonymousIP()`, `asn()`,
 * `AddressNotFoundError`), https://dev.maxmind.com/geoip/docs/databases/anonymous-ip/
 * and https://dev.maxmind.com/geoip/docs/databases/asn/ (checked 2026-11-24).
 */

const fs = require('node:fs');
const path = require('node:path');
const {
  DEFAULT_GEOIP_DIRECTORY,
  RISK_EDITION_IDS,
  readMetadata,
} = require('../../../scripts/geoip-updater.cjs');
const { calculateSecurityScore, getRiskLevel, noRiskData } = require('./risk-data');

const SAFE_GEOIP_DIRECTORY_LABEL = 'data/magic-sessionmanager/geoip';

/** The two supported risk databases. */
const RISK_DATABASES = Object.freeze({
  'anonymous-ip': Object.freeze({
    editionId: 'GeoIP2-Anonymous-IP',
    envVar: 'MAGIC_SESSIONMANAGER_ANONYMOUS_IP_DATABASE',
    method: 'anonymousIP',
  }),
  asn: Object.freeze({
    editionId: 'GeoLite2-ASN',
    envVar: 'MAGIC_SESSIONMANAGER_ASN_DATABASE',
    method: 'asn',
  }),
});

/**
 * Autonomous systems of large hosting and cloud providers. A heuristic: a
 * sign-in from these networks is usually a server, a CI job or a self-hosted
 * VPN, not a person at home. The list is short on purpose and is not a VPN
 * list. Each number was checked against its PeeringDB record on 2026-11-24
 * (https://www.peeringdb.com/asn/<number>).
 */
const HOSTING_ASNS = Object.freeze(
  new Set([
    16509, // Amazon AWS
    14618, // Amazon AWS
    396982, // Google Cloud
    8075, // Microsoft (Azure; also Microsoft's own offices)
    14061, // DigitalOcean
    24940, // Hetzner Online
    213230, // Hetzner Cloud
    16276, // OVHcloud
    63949, // Akamai Connected Cloud (Linode)
    20473, // Vultr (The Constant Company)
    51167, // Contabo
    31898, // Oracle Cloud
    45102, // Alibaba Cloud
    12876, // Scaleway
    60781, // Leaseweb Netherlands
    28753, // Leaseweb Germany
    8560, // IONOS
    47583, // Hostinger
    9009, // M247
  ])
);

const readerCache = new Map();

/**
 * Where a risk database is read from: the environment variable when set,
 * else its edition file in the plugin's GeoIP folder.
 *
 * @param {'anonymous-ip'|'asn'} kind Risk database.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {{path: string, fromEnvironment: boolean}} Read location.
 */
function resolveRiskDatabasePath(kind, env = process.env) {
  const definition = RISK_DATABASES[kind];
  const configured =
    typeof env[definition.envVar] === 'string' ? env[definition.envVar].trim() : '';
  if (configured) {
    return {
      path: path.isAbsolute(configured) ? configured : path.resolve(process.cwd(), configured),
      fromEnvironment: true,
    };
  }
  return {
    path: path.join(DEFAULT_GEOIP_DIRECTORY, `${definition.editionId}.mmdb`),
    fromEnvironment: false,
  };
}

/**
 * Opens (once per path) a MaxMind reader. The file watcher reloads a
 * database replaced by the updater and does not keep the process alive.
 *
 * @param {string} databasePath Database file.
 * @returns {Promise<object>} geoip2-node ReaderModel.
 */
async function openRiskReader(databasePath) {
  if (readerCache.has(databasePath)) return readerCache.get(databasePath);
  const { Reader } = require('@maxmind/geoip2-node');
  const readerPromise = Reader.open(databasePath, {
    watchForUpdates: true,
    watchForUpdatesNonPersistent: true,
  });
  readerCache.set(databasePath, readerPromise);
  try {
    return await readerPromise;
  } catch (error) {
    readerCache.delete(databasePath);
    throw error;
  }
}

/**
 * Forgets cached readers and their file watchers (tests and destroy).
 *
 * @returns {void}
 */
function resetRiskReaders() {
  for (const databasePath of readerCache.keys()) fs.unwatchFile(databasePath);
  readerCache.clear();
}

/**
 * Reads one address from one risk database.
 *
 * @param {'anonymous-ip'|'asn'} kind Risk database.
 * @param {string} ip Normalized IP address.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {Promise<{status: 'ok', record: object}|{status: 'absent'|'missing'}|{status: 'error', name: string}>}
 *   `absent`: the address is not in the database; `missing`: no file.
 */
async function readRiskRecord(kind, ip, env = process.env) {
  const { path: databasePath } = resolveRiskDatabasePath(kind, env);
  if (!fs.existsSync(databasePath)) return { status: 'missing' };
  try {
    const reader = await openRiskReader(databasePath);
    return { status: 'ok', record: reader[RISK_DATABASES[kind].method](ip) };
  } catch (error) {
    if (error?.name === 'AddressNotFoundError') return { status: 'absent' };
    return { status: 'error', name: error?.name || 'Error' };
  }
}

/**
 * Turns database records into the risk fields of a lookup result. The
 * Anonymous IP database is authoritative; the ASN heuristic is used only
 * without it. Field names stay those of earlier versions (`isVpn`,
 * `isProxy`, `isThreat`, ...); new: `isTor`, `isHosting`, `riskSource`.
 *
 * @param {{anonymous: object, asn: object}} records Results of readRiskRecord.
 * @returns {object} Risk fields, or noRiskData() plus `_riskStatus` without a source.
 */
function buildRiskData({ anonymous, asn }) {
  const asnRecord = asn?.status === 'ok' ? asn.record : null;
  const asnNumber = Number.isInteger(asnRecord?.autonomousSystemNumber)
    ? asnRecord.autonomousSystemNumber
    : null;
  const asnFields = asnRecord
    ? {
        asn: asnNumber === null ? null : `AS${asnNumber}`,
        org: asnRecord.autonomousSystemOrganization || null,
      }
    : {};

  let flags;
  let riskSource;
  if (anonymous?.status === 'ok' || anonymous?.status === 'absent') {
    const record = anonymous.record || {};
    riskSource = 'anonymous-ip';
    flags = {
      isAnonymous: record.isAnonymous === true,
      isVpn: record.isAnonymousVpn === true,
      isPublicProxy: record.isPublicProxy === true,
      isResidentialProxy: record.isResidentialProxy === true,
      isProxy: record.isPublicProxy === true || record.isResidentialProxy === true,
      isTor: record.isTorExitNode === true,
      isHosting: record.isHostingProvider === true,
      // MaxMind's Anonymous IP data has no "threat" category.
      isThreat: false,
    };
  } else if (asn?.status === 'ok' || asn?.status === 'absent') {
    riskSource = 'asn-heuristic';
    flags = {
      isAnonymous: false,
      isVpn: false,
      isPublicProxy: false,
      isResidentialProxy: false,
      isProxy: false,
      isTor: false,
      isHosting: asnNumber !== null && HOSTING_ASNS.has(asnNumber),
      isThreat: false,
    };
  } else {
    const failed = anonymous?.status === 'error' || asn?.status === 'error';
    return { ...noRiskData(), ...asnFields, _riskStatus: failed ? 'error' : 'missing' };
  }

  return {
    ...flags,
    ...asnFields,
    securityScore: calculateSecurityScore(flags),
    riskLevel: getRiskLevel(flags),
    riskSource,
    _riskStatus: 'ok',
  };
}

/**
 * Looks an address up in the configured risk databases.
 *
 * @param {string} ip Normalized IP address (no lookup for anything else).
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {Promise<object>} Risk fields (see buildRiskData).
 */
async function lookupRiskData(ip, env = process.env) {
  const [anonymous, asn] = await Promise.all([
    readRiskRecord('anonymous-ip', ip, env),
    readRiskRecord('asn', ip, env),
  ]);
  return buildRiskData({ anonymous, asn });
}

/**
 * Checks that a database file opens and has the expected type, by probing a
 * loopback address (BadMethodCallError means another database type).
 *
 * @param {'anonymous-ip'|'asn'} kind Risk database.
 * @param {string} databasePath Existing file.
 * @returns {Promise<boolean>} Usable.
 */
async function isUsableRiskDatabase(kind, databasePath) {
  try {
    const reader = await openRiskReader(databasePath);
    reader[RISK_DATABASES[kind].method]('127.0.0.1');
    return true;
  } catch (error) {
    return error?.name === 'AddressNotFoundError';
  }
}

/**
 * Describes one risk database for the admin, without absolute paths.
 *
 * @param {'anonymous-ip'|'asn'} kind Risk database.
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {Promise<object>} `{ editionId, exists, usable, fromEnvironment, file, metadata }`.
 */
async function describeRiskDatabase(kind, env = process.env) {
  const { editionId } = RISK_DATABASES[kind];
  const { path: databasePath, fromEnvironment } = resolveRiskDatabasePath(kind, env);
  const exists = fs.existsSync(databasePath);
  const usable = exists ? await isUsableRiskDatabase(kind, databasePath) : false;
  return {
    editionId,
    exists,
    usable,
    fromEnvironment,
    // Only the dedicated folder is named; an environment path stays private.
    file: fromEnvironment ? null : `${SAFE_GEOIP_DIRECTORY_LABEL}/${editionId}.mmdb`,
    metadata:
      !fromEnvironment && exists ? await readMetadata(`${databasePath}.metadata.json`) : null,
  };
}

/**
 * Risk data availability on this instance (each instance reads its own files).
 *
 * @param {NodeJS.ProcessEnv} [env] Environment.
 * @returns {Promise<{available: boolean, source: string|null, anonymousIp: object, asn: object}>}
 *   Availability for GET /geoip/status.
 */
async function getRiskDataStatus(env = process.env) {
  const [anonymousIp, asn] = await Promise.all([
    describeRiskDatabase('anonymous-ip', env),
    describeRiskDatabase('asn', env),
  ]);
  const source = anonymousIp.usable ? 'anonymous-ip' : asn.usable ? 'asn-heuristic' : null;
  return { available: source !== null, source, anonymousIp, asn };
}

module.exports = {
  HOSTING_ASNS,
  RISK_DATABASES,
  RISK_EDITION_IDS,
  buildRiskData,
  getRiskDataStatus,
  lookupRiskData,
  resetRiskReaders,
  resolveRiskDatabasePath,
};
