#!/usr/bin/env node

/**
 * Rollback Script: Remove session fields from user content type
 *
 * This script removes the session fields that were added via the migration.
 * It will revert the user schema to its original state (without session fields).
 *
 * Usage:
 *   node scripts/migrate-rollback-user-session-fields.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(
  __dirname,
  '../../extensions/users-permissions/content-types/user/schema.json'
);

const FIELDS_TO_REMOVE = ['isOnline', 'lastLogin', 'lastLogout', 'lastSeen'];

function rollback() {
  try {
    if (!fs.existsSync(SCHEMA_PATH)) {
      console.log('ℹ️  No extension schema found - nothing to rollback');
      return;
    }

    const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

    const fieldsRemoved = [];
    FIELDS_TO_REMOVE.forEach((fieldName) => {
      if (schema.attributes[fieldName]) {
        delete schema.attributes[fieldName];
        fieldsRemoved.push(fieldName);
      }
    });

    if (fieldsRemoved.length > 0) {
      fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2));
      console.log(`✅ Removed ${fieldsRemoved.length} fields: ${fieldsRemoved.join(', ')}`);
    } else {
      console.log('ℹ️  No session fields found - already rolled back');
    }

    console.log('\n📝 Next steps:');
    console.log('1. Run Strapi migrations: strapi db:migrate');
    console.log('2. Restart your Strapi instance: npm run develop');
    console.log('3. Session fields have been removed from the database');
  } catch (err) {
    console.error('❌ Rollback failed:', err.message);
    process.exit(1);
  }
}

rollback();
