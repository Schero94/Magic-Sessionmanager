#!/usr/bin/env node

/**
 * Migration Script: Add session fields to user content type
 * AND create the session collection type
 *
 * This script permanently adds the session fields to the user content type
 * and creates the session collection type for storing session records.
 *
 * Usage:
 *   node scripts/migrate-add-user-session-fields.js
 */

const fs = require('fs');
const path = require('path');

const SCHEMA_PATH = path.join(
  __dirname,
  '../../extensions/users-permissions/content-types/user/schema.json'
);

const NEW_FIELDS = {
  isOnline: {
    type: 'boolean',
    default: false,
    configurable: false,
  },
  lastLogin: {
    type: 'datetime',
    nullable: true,
    configurable: false,
  },
  lastLogout: {
    type: 'datetime',
    nullable: true,
    configurable: false,
  },
  lastSeen: {
    type: 'datetime',
    nullable: true,
    configurable: false,
  },
};

const SESSION_SCHEMA_PATH = path.join(
  __dirname,
  '../../src/api/session/content-types/session/schema.json'
);

const SESSION_SCHEMA = {
  kind: 'collectionType',
  collectionName: 'sessions',
  info: {
    singularName: 'session',
    pluralName: 'sessions',
    displayName: 'Session',
    description: 'User session records tracking login/logout activity and user presence',
  },
  options: {
    increments: true,
    timestamps: true,
    draftAndPublish: false,
  },
  pluginOptions: {},
  attributes: {
    id: {
      type: 'increments',
      primaryKey: true,
      configurable: false,
    },
    user: {
      type: 'relation',
      relation: 'manyToOne',
      target: 'plugin::users-permissions.user',
      inversedBy: 'sessions',
      required: true,
      configurable: false,
    },
    ipAddress: {
      type: 'string',
      configurable: false,
      required: true,
      maxLength: 45,
    },
    userAgent: {
      type: 'text',
      configurable: false,
      required: true,
    },
    loginTime: {
      type: 'datetime',
      configurable: false,
      required: true,
    },
    logoutTime: {
      type: 'datetime',
      configurable: false,
      nullable: true,
    },
    lastActive: {
      type: 'datetime',
      configurable: false,
      required: true,
    },
    isActive: {
      type: 'boolean',
      default: true,
      configurable: false,
      required: true,
    },
  },
};

function migrate() {
  try {
    // 1. Add fields to user content type
    console.log('📝 Step 1: Adding session fields to user content type...');

    if (!fs.existsSync(SCHEMA_PATH)) {
      console.log(`📁 Creating extension schema at ${SCHEMA_PATH}...`);

      const dir = path.dirname(SCHEMA_PATH);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }

      const schema = {
        kind: 'collectionType',
        collectionName: 'up_users',
        info: {
          name: 'user',
          description: '',
        },
        options: {},
        attributes: {},
      };

      Object.assign(schema.attributes, NEW_FIELDS);
      fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2));
      console.log('✅ Extension schema created with session fields');
    } else {
      const schema = JSON.parse(fs.readFileSync(SCHEMA_PATH, 'utf8'));

      const fieldsAdded = [];
      Object.entries(NEW_FIELDS).forEach(([fieldName, fieldConfig]) => {
        if (!schema.attributes[fieldName]) {
          schema.attributes[fieldName] = fieldConfig;
          fieldsAdded.push(fieldName);
        }
      });

      if (fieldsAdded.length > 0) {
        fs.writeFileSync(SCHEMA_PATH, JSON.stringify(schema, null, 2));
        console.log(`✅ Added ${fieldsAdded.length} fields: ${fieldsAdded.join(', ')}`);
      } else {
        console.log('ℹ️  All fields already present');
      }
    }

    // 2. Create session collection type
    console.log('📝 Step 2: Creating session collection type...');

    const sessionDir = path.dirname(SESSION_SCHEMA_PATH);
    if (!fs.existsSync(sessionDir)) {
      fs.mkdirSync(sessionDir, { recursive: true });
      console.log('📁 Created session collection directory');
    }

    if (!fs.existsSync(SESSION_SCHEMA_PATH)) {
      fs.writeFileSync(SESSION_SCHEMA_PATH, JSON.stringify(SESSION_SCHEMA, null, 2));
      console.log('✅ Session collection schema created');
    } else {
      console.log('ℹ️  Session collection schema already exists');
    }

    console.log('\n📝 Next steps:');
    console.log('1. Run Strapi migrations: strapi db:migrate');
    console.log('2. Restart your Strapi instance: npm run develop');
    console.log('3. Fields and collections will now be permanently stored in the database');
    console.log('\n✅ Migration complete!');
  } catch (err) {
    console.error('❌ Migration failed:', err.message);
    process.exit(1);
  }
}

migrate();
