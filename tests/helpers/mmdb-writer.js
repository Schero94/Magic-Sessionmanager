'use strict';

/**
 * Minimal MaxMind DB writer for test fixtures.
 *
 * Writes an IPv4 MaxMind DB (format 2.0, 24-bit records) with synthetic
 * records, so tests exercise the real `@maxmind/geoip2-node` reader without
 * shipping MaxMind's binary databases. Implements only what the fixtures
 * need: maps, UTF-8 strings, booleans, unsigned 32-bit integers and arrays.
 *
 * Format: MaxMind DB spec (https://maxmind.github.io/MaxMind-DB/): search
 * tree, 16-byte data section separator, data field encoding, metadata
 * marker. Checked against the installed mmdb-lib 3.0.3 reader and metadata
 * parser, which every fixture must open.
 */

const METADATA_MARKER = Buffer.from('abcdef4d61784d696e642e636f6d', 'hex');
const TYPE = Object.freeze({ utf8: 2, map: 7, uint32: 6, array: 11, boolean: 14 });

/**
 * Encodes a control byte with type and payload size.
 *
 * @param {number} type MaxMind DB data type.
 * @param {number} size Payload size (or value for booleans, entries for maps).
 * @returns {Buffer} Control bytes.
 */
function control(type, size) {
  const bytes = [];
  let first = type <= 7 ? type << 5 : 0;
  const extra = [];
  if (size < 29) {
    first |= size;
  } else if (size < 285) {
    first |= 29;
    extra.push(size - 29);
  } else if (size < 65821) {
    first |= 30;
    const rest = size - 285;
    extra.push(rest >> 8, rest & 0xff);
  } else {
    throw new Error('fixture value too large');
  }
  bytes.push(first);
  if (type > 7) bytes.push(type - 7);
  return Buffer.from([...bytes, ...extra]);
}

/**
 * Encodes one value of the data section.
 *
 * @param {unknown} value String, boolean, non-negative integer, array or plain object.
 * @returns {Buffer} Encoded field.
 */
function encode(value) {
  if (typeof value === 'string') {
    const payload = Buffer.from(value, 'utf8');
    return Buffer.concat([control(TYPE.utf8, payload.length), payload]);
  }
  if (typeof value === 'boolean') return control(TYPE.boolean, value ? 1 : 0);
  if (typeof value === 'number') {
    if (!Number.isInteger(value) || value < 0 || value > 0xffffffff) {
      throw new Error('fixture numbers must be uint32');
    }
    const bytes = [];
    for (let rest = value; rest > 0; rest = Math.floor(rest / 256)) bytes.unshift(rest % 256);
    return Buffer.concat([control(TYPE.uint32, bytes.length), Buffer.from(bytes)]);
  }
  if (Array.isArray(value)) {
    return Buffer.concat([control(TYPE.array, value.length), ...value.map(encode)]);
  }
  if (value && typeof value === 'object') {
    const entries = Object.entries(value);
    return Buffer.concat([
      control(TYPE.map, entries.length),
      ...entries.flatMap(([key, entry]) => [encode(key), encode(entry)]),
    ]);
  }
  throw new Error(`unsupported fixture value: ${typeof value}`);
}

/**
 * Parses "a.b.c.d/len" into its 32 address bits.
 *
 * @param {string} cidr IPv4 network.
 * @returns {{bits: number[], length: number}} Address bits and prefix length.
 */
function parseCidr(cidr) {
  const [address, lengthText] = cidr.split('/');
  const length = Number(lengthText);
  const octets = address.split('.').map(Number);
  if (octets.length !== 4 || !(length >= 1 && length <= 32)) throw new Error(`bad CIDR ${cidr}`);
  const bits = octets.flatMap((octet) =>
    Array.from({ length: 8 }, (_, index) => (octet >> (7 - index)) & 1)
  );
  return { bits, length };
}

/**
 * Builds a MaxMind DB buffer.
 *
 * @param {object} options
 * @param {string} options.databaseType Metadata `database_type`, e.g. 'GeoIP2-Anonymous-IP'.
 * @param {Array<{network: string, data: object}>} options.records IPv4 networks and their records.
 * @returns {Buffer} Database bytes.
 */
function buildMmdb({ databaseType, records }) {
  const root = { children: [null, null] };
  const dataParts = [];
  let dataLength = 0;

  for (const { network, data } of records) {
    const { bits, length } = parseCidr(network);
    const encoded = encode(data);
    const leaf = { dataOffset: dataLength };
    dataParts.push(encoded);
    dataLength += encoded.length;

    let node = root;
    for (let depth = 0; depth < length - 1; depth += 1) {
      const bit = bits[depth];
      if (!node.children[bit] || node.children[bit].dataOffset !== undefined) {
        node.children[bit] = { children: [null, null] };
      }
      node = node.children[bit];
    }
    node.children[bits[length - 1]] = leaf;
  }

  // Number the nodes breadth first; node 0 is the root.
  const nodes = [];
  const queue = [root];
  while (queue.length > 0) {
    const node = queue.shift();
    node.index = nodes.length;
    nodes.push(node);
    for (const child of node.children) {
      if (child && child.dataOffset === undefined) queue.push(child);
    }
  }
  const nodeCount = nodes.length;
  const recordValue = (child) => {
    if (!child) return nodeCount;
    if (child.dataOffset !== undefined) return nodeCount + 16 + child.dataOffset;
    return child.index;
  };

  const tree = Buffer.alloc(nodeCount * 6);
  nodes.forEach((node, index) => {
    tree.writeUIntBE(recordValue(node.children[0]), index * 6, 3);
    tree.writeUIntBE(recordValue(node.children[1]), index * 6 + 3, 3);
  });

  const metadata = encode({
    binary_format_major_version: 2,
    binary_format_minor_version: 0,
    build_epoch: 1795000000,
    database_type: databaseType,
    description: { en: 'Synthetic test database' },
    ip_version: 4,
    languages: ['en'],
    node_count: nodeCount,
    record_size: 24,
  });

  return Buffer.concat([tree, Buffer.alloc(16), ...dataParts, METADATA_MARKER, metadata]);
}

module.exports = { buildMmdb };
