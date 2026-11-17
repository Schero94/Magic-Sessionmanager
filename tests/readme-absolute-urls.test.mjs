import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// The Strapi marketplace and npm render the README shipped in the npm package
// relative to their own pages, so relative image and link URLs break there
// (4.13.0 shipped 15 broken references). Only absolute https:// URLs and
// in-page #anchors work everywhere.
const readme = readFileSync(new URL('../README.md', import.meta.url), 'utf8');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'));

const IMAGE_HOSTS = [
  'https://schero94.github.io/Magic-Sessionmanager/',
  'https://raw.githubusercontent.com/Schero94/Magic-Sessionmanager/',
];
const BADGE_HOST = 'https://img.shields.io/';
const BADGE_ACTIONS = 'https://github.com/Schero94/Magic-Sessionmanager/actions/';
const MAX_SCREENSHOTS = 8;

/** Strips fenced code blocks and inline code so examples are not checked. */
const prose = readme.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

/**
 * Collects every markdown image, markdown link and HTML src/href in the README.
 *
 * @returns {{ kind: 'image' | 'link', url: string, alt?: string }[]}
 */
function collectRefs() {
  const refs = [];
  for (const m of prose.matchAll(/!\[([^\]]*)\]\(\s*<?([^)\s>]+)>?(?:\s+"[^"]*")?\s*\)/g)) {
    refs.push({ kind: 'image', alt: m[1], url: m[2] });
  }
  // Every "](url)" target, including the outer link of nested badge syntax.
  for (const m of prose.matchAll(/\]\(\s*<?([^)\s>]+)/g)) {
    refs.push({ kind: 'link', url: m[1] });
  }
  // Reference-style definitions: "[label]: url".
  for (const m of prose.matchAll(/^\s{0,3}\[[^\]]+\]:\s*<?(\S+?)>?(?:\s|$)/gm)) {
    refs.push({ kind: 'link', url: m[1] });
  }
  for (const m of prose.matchAll(/<img\b[^>]*>/gi)) {
    const src = /\ssrc="([^"]*)"/i.exec(m[0]);
    const alt = /\salt="([^"]*)"/i.exec(m[0]);
    refs.push({ kind: 'image', url: src ? src[1] : '', alt: alt ? alt[1] : '' });
  }
  for (const m of prose.matchAll(/<a\b[^>]*\shref="([^"]*)"/gi)) {
    refs.push({ kind: 'link', url: m[1] });
  }
  return refs;
}

const refs = collectRefs();
const images = refs.filter((r) => r.kind === 'image');

test('README finds the images and links it should check', () => {
  assert.ok(images.length >= 3, `expected images, found ${images.length}`);
  assert.ok(refs.filter((r) => r.kind === 'link').length >= 5, 'expected links');
});

test('every README image and link is absolute https:// or an in-page #anchor', () => {
  const bad = refs.filter((r) => !/^https:\/\//.test(r.url) && !/^#[\w-]+$/.test(r.url));
  assert.deepEqual(bad, [], 'relative URLs break on the Strapi marketplace and npm');
});

test('every README image has non-empty alt text', () => {
  const missing = images.filter((r) => !r.alt || !r.alt.trim());
  assert.deepEqual(missing, []);
});

test('README screenshots are served from the project Pages site or raw GitHub', () => {
  const offHost = images.filter(
    (r) =>
      !IMAGE_HOSTS.some((host) => r.url.startsWith(host)) &&
      !r.url.startsWith(BADGE_HOST) &&
      !r.url.startsWith(BADGE_ACTIONS)
  );
  assert.deepEqual(offHost, []);
});

test(`README shows at most ${MAX_SCREENSHOTS} screenshots and links the full gallery`, () => {
  const screenshots = images.filter((r) => /\.(png|webp|jpe?g|gif)$/i.test(r.url));
  assert.ok(
    screenshots.length <= MAX_SCREENSHOTS,
    `found ${screenshots.length} screenshots; move extras to the Pages gallery`
  );
  assert.ok(readme.includes('https://schero94.github.io/Magic-Sessionmanager/#screenshots'));
});

test('package no longer ships the unused pics folder', () => {
  assert.ok(!pkg.files.includes('pics'), 'README images come from the Pages site');
});
