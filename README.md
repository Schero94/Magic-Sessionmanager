# Magic Session Manager

Advanced session management for Strapi v5 - Track user login/logout, session history, and online status without modifying core files.

## Features

✅ **User Session Fields Injection** - Automatically adds `isOnline`, `lastLogin`, `lastLogout`, `lastSeen` to users  
✅ **Session Collection** - Complete session history with IP, user agent, and activity timestamps  
✅ **Login/Logout Integration** - Seamless session creation on login, termination on logout  
✅ **Activity Tracking** - Rate-limited `lastSeen` updates to prevent DB noise (30s default)  
✅ **Admin Dashboard** - View all active sessions in a beautiful interface  
✅ **Content Manager Integration** - Fields visible in user list and detail views  
✅ **Multi-User Safe** - No core modifications, pure runtime injection  

## Installation

1. Copy/clone this plugin to `src/plugins/magic-sessionmanager/`

2. Register in `config/plugins.ts`:

```typescript
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
    resolve: './src/plugins/magic-sessionmanager'
  },
});
```

3. Install and build:

```bash
npm install
npm run build --workspace=src/plugins/magic-sessionmanager
```

4. Start Strapi:

```bash
npm run develop
```

## API Endpoints

### Content API

#### Get Active Sessions
```bash
GET /api/magic-sessionmanager/sessions
```

#### Get User Sessions
```bash
GET /api/magic-sessionmanager/user/:userId/sessions
```

#### Logout
```bash
POST /api/magic-sessionmanager/logout
# Requires authentication
```

#### Terminate Session
```bash
DELETE /api/magic-sessionmanager/sessions/:sessionId
```

### Admin API

```bash
GET /api/magic-sessionmanager/admin/sessions # Requires admin auth
GET /api/magic-sessionmanager/admin/user/:userId/sessions
```

## Testing

### 1. Register/Login Test

```bash
# Register user
curl -X POST http://localhost:1337/api/auth/local/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "Test@123"
  }'

# Login
curl -X POST http://localhost:1337/api/auth/local \
  -H "Content-Type: application/json" \
  -d '{
    "identifier": "test@example.com",
    "password": "Test@123"
  }'
# Copy the JWT token
```

### 2. Check User Session Fields

```bash
# Get users with session fields
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Response includes:
# {
#   "id": 1,
#   "username": "testuser",
#   "email": "test@example.com",
#   "isOnline": true,
#   "lastLogin": "2024-01-15T10:30:00Z",
#   "lastSeen": "2024-01-15T10:30:05Z",
#   "lastLogout": null
# }
```

### 3. Check Session Records

```bash
curl http://localhost:1337/api/magic-sessionmanager/sessions \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Response:
# {
#   "data": [
#     {
#       "id": 1,
#       "user": { "id": 1, "email": "test@example.com" },
#       "ipAddress": "::1",
#       "userAgent": "curl/7.64.1",
#       "loginTime": "2024-01-15T10:30:00Z",
#       "lastActive": "2024-01-15T10:30:05Z",
#       "isActive": true,
#       "logoutTime": null
#     }
#   ],
#   "meta": { "count": 1 }
# }
```

### 4. Test Activity Tracking

```bash
# Make authenticated request (updates lastSeen if >30s old)
curl http://localhost:1337/api/users \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"
```

### 5. Logout Test

```bash
curl -X POST http://localhost:1337/api/magic-sessionmanager/logout \
  -H "Authorization: Bearer YOUR_JWT_TOKEN"

# Response: { "message": "Logged out successfully" }
# Then check: lastLogout is set, isOnline = false, isActive = false
```

## Configuration

In `config/plugins.ts`, you can customize:

```typescript
export default () => ({
  'magic-sessionmanager': {
    enabled: true,
    resolve: './src/plugins/magic-sessionmanager',
    config: {
      // Rate limit for lastSeen updates (milliseconds)
      lastSeenRateLimit: 30000, // 30 seconds (default)
      
      // Auto-logout inactive sessions
      inactivityTimeout: 24 * 60 * 60 * 1000, // 24 hours (default)
    }
  },
});
```

## Content Types

### User (Extended)

New fields added to `plugin::users-permissions.user`:

- `isOnline: boolean` - Current login status
- `lastLogin: datetime | null` - Last successful login
- `lastLogout: datetime | null` - Last successful logout
- `lastSeen: datetime | null` - Last activity timestamp (rate-limited)

### Session

Collection type `plugin::magic-sessionmanager.session`:

- `user` - Relation to user (manyToOne)
- `ipAddress` - Client IP address
- `userAgent` - Browser/client info
- `loginTime` - Session start timestamp
- `logoutTime` - Session end timestamp (null if active)
- `lastActive` - Last activity in session (rate-limited)
- `isActive` - Whether session is still valid

## Multi-Instance & Redis (Production)

For deployment with multiple instances, use Redis for:

1. **Session Store** - Replace DB with Redis for faster lookups
2. **Rate Limiting** - Use Redis for distributed rate limiting (lastSeen)
3. **Locks** - Prevent race conditions on concurrent requests

Example Redis integration:

```javascript
// server/services/session.js - Add Redis client
const redis = require('redis');
const client = redis.createClient();

// Store sessions in Redis instead of DB
async createSession({ userId, ip, userAgent }) {
  const sessionId = `session:${userId}:${Date.now()}`;
  await client.setex(sessionId, 86400, JSON.stringify({ userId, ip, userAgent, loginTime: Date.now() }));
  return { id: sessionId };
}
```

## Migration & Rollback

The plugin injects fields at runtime. To make them persistent:

### Add Fields to User CT (Optional)

If you want fields in the database schema permanently, add to `src/extensions/users-permissions/content-types/user/schema.json`:

```json
{
  "attributes": {
    "isOnline": {
      "type": "boolean",
      "default": false
    },
    "lastLogin": {
      "type": "datetime",
      "nullable": true
    },
    "lastLogout": {
      "type": "datetime",
      "nullable": true
    },
    "lastSeen": {
      "type": "datetime",
      "nullable": true
    }
  }
}
```

Then run migrations (check Strapi docs for your version).

### Rollback

Simply disable the plugin in `config/plugins.ts`:

```typescript
'magic-sessionmanager': {
  enabled: false, // Disables all features
}
```

## Troubleshooting

### Sessions not creating on login?

- Check Strapi logs for errors
- Ensure users-permissions plugin is enabled
- Verify JWT token is being generated correctly

### lastSeen not updating?

- Default rate limit is 30 seconds - make requests more frequently
- Check middleware is mounted in bootstrap.js
- Verify ctx.state.user exists in authenticated requests

### Admin panel not showing sessions?

- Build the admin UI: `npm run build --workspace=src/plugins/magic-sessionmanager`
- Check browser console for JS errors
- Verify Content Manager permissions

## Development

```bash
# Watch mode for development
npm run watch --workspace=src/plugins/magic-sessionmanager

# Link to local Strapi for testing
npm run watch:link --workspace=src/plugins/magic-sessionmanager

# Verify plugin integrity
npm run verify --workspace=src/plugins/magic-sessionmanager
```

## License

MIT - See LICENSE file

## Support

For issues, feature requests, or questions, please open an issue on the repository.
