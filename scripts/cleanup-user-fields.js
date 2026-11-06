#!/usr/bin/env node

/**
 * Cleanup Script: Remove session fields from users table
 * Use this if old fields persist in database after removing injection
 */

const fs = require('fs');
const path = require('path');

console.log('╔════════════════════════════════════════════════════════════╗');
console.log('║  🧹 Remove isOnline, lastLogin, lastLogout, lastSeen      ║');
console.log('╚════════════════════════════════════════════════════════════╝\n');

console.log('📝 To remove these fields from your database:');
console.log('');
console.log('Option 1: Via Strapi Admin Panel');
console.log('  1. Go to Content-Type Builder');
console.log('  2. Edit "User" (under Users & Permissions)');
console.log('  3. Delete fields: isOnline, lastLogin, lastLogout, lastSeen');
console.log('  4. Save (Strapi will migrate automatically)');
console.log('');
console.log('Option 2: Via SQL (if using SQLite):');
console.log('  sqlite3 .tmp/data.db');
console.log('  ALTER TABLE up_users DROP COLUMN is_online;');
console.log('  ALTER TABLE up_users DROP COLUMN last_login;');
console.log('  ALTER TABLE up_users DROP COLUMN last_logout;');
console.log('  ALTER TABLE up_users DROP COLUMN last_seen;');
console.log('  .exit');
console.log('');
console.log('Option 3: Delete and recreate database');
console.log('  rm -rf .tmp/data.db');
console.log('  npm run develop  # Strapi recreates DB automatically');
console.log('');
console.log('✅ After cleanup, only "sessions" relation will remain in User!');
