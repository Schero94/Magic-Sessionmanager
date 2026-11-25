'use strict';

// @ts-check

/**
 * Special-purpose IP ranges that are never looked up at a location provider
 * (4.17, security review F1). Built on Node's `net.BlockList`
 * (https://nodejs.org/api/net.html#class-netblocklist), which also matches
 * IPv4-mapped IPv6 addresses against the IPv4 rules.
 *
 * Sources: IANA IPv4 and IPv6 Special-Purpose Address Registries
 * (https://www.iana.org/assignments/iana-ipv4-special-registry,
 * https://www.iana.org/assignments/iana-ipv6-special-registry), checked
 * 2026-11-25. Listed: every block that is not globally reachable, plus the
 * documentation, benchmarking and multicast blocks. Globally reachable
 * blocks (AS112, AMT, NAT64 64:ff9b::/96) are looked up like any address.
 */

const net = require('node:net');

/** IPv4 blocks: [network, prefix length]. */
const IPV4_SPECIAL = Object.freeze([
  ['0.0.0.0', 8], // "this network"
  ['10.0.0.0', 8], // private (RFC 1918)
  ['100.64.0.0', 10], // shared address space / CGNAT (RFC 6598)
  ['127.0.0.0', 8], // loopback
  ['169.254.0.0', 16], // link-local
  ['172.16.0.0', 12], // private (RFC 1918)
  ['192.0.0.0', 24], // IETF protocol assignments
  ['192.0.2.0', 24], // documentation TEST-NET-1
  ['192.88.99.0', 24], // deprecated 6to4 relay anycast
  ['192.168.0.0', 16], // private (RFC 1918)
  ['198.18.0.0', 15], // benchmarking
  ['198.51.100.0', 24], // documentation TEST-NET-2
  ['203.0.113.0', 24], // documentation TEST-NET-3
  ['224.0.0.0', 4], // multicast
  ['240.0.0.0', 4], // reserved, includes 255.255.255.255
]);

/** IPv6 blocks: [network, prefix length]. */
const IPV6_SPECIAL = Object.freeze([
  ['::', 96], // unspecified, loopback and deprecated IPv4-compatible addresses
  ['64:ff9b:1::', 48], // local-use IPv4/IPv6 translation
  ['100::', 64], // discard-only
  ['100:0:0:1::', 64], // dummy prefix
  ['2001::', 23], // IETF protocol assignments (Teredo, benchmarking, ORCHID)
  ['2001:db8::', 32], // documentation
  ['3fff::', 20], // documentation (RFC 9637)
  ['5f00::', 16], // segment routing SIDs
  ['fc00::', 7], // unique local
  ['fe80::', 10], // link-local
  ['fec0::', 10], // deprecated site-local
  ['ff00::', 8], // multicast
]);

const blockList = new net.BlockList();
for (const [network, prefix] of IPV4_SPECIAL) blockList.addSubnet(network, prefix, 'ipv4');
for (const [network, prefix] of IPV6_SPECIAL) blockList.addSubnet(network, prefix, 'ipv6');

/**
 * Whether an address lies in a special-purpose range (private, loopback,
 * link-local, CGNAT, documentation, benchmarking, multicast, reserved, ...).
 * Anything that is not an IP address counts as special, so it is never sent
 * to a provider.
 *
 * @param {unknown} ip Address (IPv4, IPv6 or IPv4-mapped IPv6; brackets and zone ids allowed).
 * @returns {boolean}
 */
function isSpecialPurposeIp(ip) {
  if (typeof ip !== 'string') return true;
  let value = ip.trim();
  if (value.startsWith('[') && value.endsWith(']')) value = value.slice(1, -1);
  const zone = value.indexOf('%');
  if (zone !== -1) value = value.slice(0, zone);
  const version = net.isIP(value);
  if (version === 4) return blockList.check(value, 'ipv4');
  if (version === 6) return blockList.check(value, 'ipv6');
  return true;
}

module.exports = { IPV4_SPECIAL, IPV6_SPECIAL, isSpecialPurposeIp };
