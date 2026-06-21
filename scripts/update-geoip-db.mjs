#!/usr/bin/env node

import { createRequire } from 'node:module';
import process from 'node:process';

const require = createRequire(import.meta.url);
const updater = require('./geoip-updater.cjs');

export const DEFAULT_EDITION_ID = updater.DEFAULT_EDITION_ID;
export const DEFAULT_MMDB_NAME = updater.DEFAULT_MMDB_NAME;
export const DEFAULT_OUTPUT_PATH = updater.DEFAULT_OUTPUT_PATH;
export const buildBasicAuthHeader = updater.buildBasicAuthHeader;
export const buildDownloadUrl = updater.buildDownloadUrl;
export const extractMmdbFromTarGz = updater.extractMmdbFromTarGz;
export const fileExists = updater.fileExists;
export const needsDownload = updater.needsDownload;
export const readMetadata = updater.readMetadata;
export const resolveConfig = updater.resolveConfig;
export const updateGeoIpDatabase = updater.updateGeoIpDatabase;

function isMainModule() {
  return process.argv[1] && import.meta.url === new URL(process.argv[1], 'file:').href;
}

if (isMainModule()) {
  updateGeoIpDatabase()
    .then((result) => {
      console.log(result.message);
      console.log(`Path: ${result.outputPath}`);
      if (result.lastModified) {
        console.log(`Last-Modified: ${result.lastModified}`);
      }
    })
    .catch((err) => {
      console.error(`GeoIP update failed: ${err.message}`);
      process.exitCode = 1;
    });
}
