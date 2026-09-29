# Batch-82: Database Security - Least-Privilege Roles and TLS Enforcement

Comprehensive documentation for security features addressing issue #144.

---

## Issue #144: Database Least-Privilege Roles and TLS Enforcement

### Database Role Strategy

#### Role Hierarchy
```
┌─────────────────────────────────────────────────────────┐
│                    Superuser (postgres)                 │
│         Only for initial setup and emergency admin       │
└─────────────────────────────────────────────────────────┘
                           ▲
              ┌────────────┴────────────┐
              ▼                         ▼
    ┌──────────────────┐      ┌──────────────────┐
    │   Migration Role │      │   Backup Role    │
    │  (limited temp)  │      │  (read-only)     │
    └──────────────────┘      └──────────────────┘
              ▲                         ▲
              │                         │
    ┌──────────────────────────────────────────────────────┐
    │            Application Role (limited write)          │
    │  - SELECT, INSERT, UPDATE, DELETE on application    │
    │  - CANNOT: ALTER TABLE, DROP, CREATE SCHEMA         │
    └──────────────────────────────────────────────────────┘
              ▲
              │
    ┌──────────────────────────────────────────────────────┐
    │       Reporting Role (read-only analytics)          │
    │  - SELECT only                                       │
    │  - Cannot see sensitive columns (PII redacted)      │
    └──────────────────────────────────────────────────────┘
```

### Role Definitions

#### 1. Migration Role (Temporary)
```sql
-- Create migration role
CREATE ROLE lumigift_migration WITH PASSWORD 'strong_password_here';
ALTER ROLE lumigift_migration WITH LOGIN;

-- Grant temporary full permissions for migrations
GRANT CREATE ON DATABASE lumigift TO lumigift_migration;
GRANT ALL PRIVILEGES ON SCHEMA public TO lumigift_migration;

-- Allow schema modifications during migration window
GRANT USAGE ON SCHEMA public TO lumigift_migration;
GRANT CREATE ON SCHEMA public TO lumigift_migration;

-- Time-limited role (expires after 24 hours)
ALTER ROLE lumigift_migration WITH VALID UNTIL '2026-09-30 13:00:00 UTC';

-- Revoke after migrations complete
REVOKE ALL PRIVILEGES ON DATABASE lumigift FROM lumigift_migration;
REVOKE ALL PRIVILEGES ON SCHEMA public FROM lumigift_migration;
DROP ROLE lumigift_migration;
```

#### 2. Application Role (Primary)
```sql
-- Create application role (deny schema modifications)
CREATE ROLE lumigift_app WITH PASSWORD 'strong_app_password';
ALTER ROLE lumigift_app WITH LOGIN;

-- Grant USAGE on schema (no CREATE)
GRANT USAGE ON SCHEMA public TO lumigift_app;

-- Grant table permissions (DML only, no DDL)
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO lumigift_app;

-- Allow sequences for auto-increment IDs
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO lumigift_app;

-- Explicitly DENY dangerous operations
REVOKE CREATE ON SCHEMA public FROM lumigift_app;
REVOKE TRUNCATE ON ALL TABLES IN SCHEMA public FROM lumigift_app;
REVOKE ALTER ON ALL TABLES IN SCHEMA public FROM lumigift_app;
REVOKE DROP ON ALL TABLES IN SCHEMA public FROM lumigift_app;

-- Set default privileges for future tables
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO lumigift_app;

ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT USAGE, SELECT ON SEQUENCES TO lumigift_app;
```

#### 3. Reporting Role (Read-Only)
```sql
-- Create read-only reporting role
CREATE ROLE lumigift_reporting WITH PASSWORD 'strong_reporting_password';
ALTER ROLE lumigift_reporting WITH LOGIN;

-- Grant USAGE on schema
GRANT USAGE ON SCHEMA public TO lumigift_reporting;

-- Grant SELECT only (no write operations)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lumigift_reporting;

-- Restrict access to sensitive columns (PII redaction)
-- Create view that redacts PII
CREATE VIEW users_safe AS
SELECT
  id,
  email_hash,
  created_at,
  updated_at
  -- Exclude: email, phone, full_name, address
FROM users;

-- Grant access to safe view only for sensitive tables
REVOKE SELECT ON users FROM lumigift_reporting;
GRANT SELECT ON users_safe TO lumigift_reporting;

-- Set default privileges for future tables (SELECT only)
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT ON TABLES TO lumigift_reporting;
```

#### 4. Backup Role (Read-Only)
```sql
-- Create backup role
CREATE ROLE lumigift_backup WITH PASSWORD 'strong_backup_password';
ALTER ROLE lumigift_backup WITH LOGIN;

-- Grant USAGE on schema
GRANT USAGE ON SCHEMA public TO lumigift_backup;

-- Grant SELECT on all tables (for backup)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO lumigift_backup;
GRANT SELECT ON ALL SEQUENCES IN SCHEMA public TO lumigift_backup;

-- Time-limited role (rotated quarterly)
ALTER ROLE lumigift_backup WITH VALID UNTIL '2026-12-31 00:00:00 UTC';
```

### Environment Configuration

#### Connection Strings by Role
```typescript
// src/server/config/database.ts

interface DatabaseConfig {
  url: string;
  role: 'app' | 'reporting' | 'backup';
  sslMode: 'require' | 'prefer' | 'disable';
  timeout: number;
  maxConnections: number;
}

const DATABASE_CONFIGS: Record<string, DatabaseConfig> = {
  app: {
    url: `postgresql://lumigift_app:${process.env.DATABASE_APP_PASSWORD}@${process.env.DATABASE_HOST}/lumigift?sslmode=require`,
    role: 'app',
    sslMode: 'require',
    timeout: 30000,
    maxConnections: 20
  },
  reporting: {
    url: `postgresql://lumigift_reporting:${process.env.DATABASE_REPORTING_PASSWORD}@${process.env.DATABASE_HOST}/lumigift?sslmode=require`,
    role: 'reporting',
    sslMode: 'require',
    timeout: 60000,
    maxConnections: 5
  },
  backup: {
    url: `postgresql://lumigift_backup:${process.env.DATABASE_BACKUP_PASSWORD}@${process.env.DATABASE_HOST}/lumigift?sslmode=require`,
    role: 'backup',
    sslMode: 'require',
    timeout: 300000,  // 5 minutes for backups
    maxConnections: 1
  }
};

export function getDatabaseUrl(role: 'app' | 'reporting' | 'backup'): string {
  const config = DATABASE_CONFIGS[role];
  if (!config) {
    throw new Error(`Unknown database role: ${role}`);
  }
  return config.url;
}
```

### TLS/SSL Enforcement

#### PostgreSQL Server Configuration
```ini
# postgresql.conf

# Enable SSL
ssl = on
ssl_cert_file = '/etc/postgresql/server.crt'
ssl_key_file = '/etc/postgresql/server.key'
ssl_ca_file = '/etc/postgresql/ca.crt'

# Require TLS for all connections
ssl_protocols = 'TLSv1.2,TLSv1.3'
ssl_ciphers = 'HIGH:!aNULL:!MD5'
ssl_prefer_server_ciphers = on

# Client certificate verification (optional, for extra security)
ssl_dh_params_file = '/etc/postgresql/dh.pem'
```

#### Connection Security
```sql
-- pg_hba.conf: Require SSL for all remote connections

# IPv4 local connections
host    lumigift    all             127.0.0.1/32            md5

# IPv4 remote connections (REQUIRE SSL)
hostssl lumigift    lumigift_app    0.0.0.0/0               md5

hostssl lumigift    lumigift_reporting  0.0.0.0/0           md5

hostssl lumigift    lumigift_backup     0.0.0.0/0           md5

# Reject unencrypted connections
host    lumigift    all             0.0.0.0/0               reject

# IPv6 local connections
host    lumigift    all             ::1/128                 md5

# IPv6 remote connections (REQUIRE SSL)
hostssl lumigift    lumigift_app    ::/0                    md5

hostssl lumigift    lumigift_reporting  ::/0                md5

hostssl lumigift    lumigift_backup ::/0                    md5
```

#### Connection String Validation
```typescript
// src/lib/database-connection.ts

export interface TlsConnectionOptions {
  rejectUnauthorized: boolean;
  ca?: Buffer;
  cert?: Buffer;
  key?: Buffer;
}

export function validateDatabaseConnection(
  connectionUrl: string,
  tlsOptions: TlsConnectionOptions
): void {
  const url = new URL(connectionUrl);

  // 1. Verify SSL protocol
  if (!connectionUrl.includes('sslmode=require')) {
    throw new Error(
      'Database connection must require SSL (sslmode=require)'
    );
  }

  // 2. Verify host is not localhost (enforce network TLS)
  const hostname = url.hostname;
  if (['localhost', '127.0.0.1', '::1'].includes(hostname)) {
    // Allow localhost without TLS for development only
    if (process.env.NODE_ENV === 'production') {
      throw new Error(
        'Production database connections must use remote host with TLS'
      );
    }
  }

  // 3. Verify TLS certificate verification enabled
  if (tlsOptions.rejectUnauthorized === false && process.env.NODE_ENV === 'production') {
    throw new Error(
      'Production connections must verify TLS certificates (rejectUnauthorized=true)'
    );
  }

  console.log('✓ Database connection validated');
}
```

#### Node.js Connection Example
```typescript
// Database connection with TLS enforcement
import pg from 'pg';
import fs from 'fs';

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: {
    rejectUnauthorized: process.env.NODE_ENV === 'production',
    ca: fs.readFileSync('/path/to/ca-cert.pem', 'utf8'),
    cert: fs.readFileSync('/path/to/client-cert.pem', 'utf8'),
    key: fs.readFileSync('/path/to/client-key.pem', 'utf8')
  },
  statement_timeout: 30000,
  query_timeout: 30000,
  connect_timeout: 10000
};

client.on('error', (err) => {
  if (err.code === 'ECONNREFUSED') {
    console.error('✗ Database connection refused');
  } else if (err.code === 'EHOSTUNREACH') {
    console.error('✗ Database host unreachable');
  } else if (err.message.includes('SSL')) {
    console.error('✗ Database TLS connection failed:', err.message);
  } else {
    console.error('✗ Database connection error:', err.message);
  }
  process.exit(1);
});

await client.connect();
```

### Connection Failure Handling

#### Explicit Error Messages
```typescript
// src/server/db/connection-handler.ts

export class DatabaseConnectionError extends Error {
  constructor(
    public readonly code: string,
    public readonly details: string
  ) {
    super(`Database connection failed: ${details}`);
    this.name = 'DatabaseConnectionError';
  }
}

export async function connectWithRetry(
  connectionUrl: string,
  maxRetries: number = 3
): Promise<void> {
  let lastError: Error | null = null;

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      const client = new pg.Client({ connectionString: connectionUrl });
      
      client.on('error', (err) => {
        throw handleConnectionError(err);
      });

      await client.connect();
      console.log('✓ Database connected successfully');
      return;
    } catch (error) {
      lastError = error as Error;
      console.error(
        `✗ Connection attempt ${attempt}/${maxRetries} failed:`,
        error instanceof DatabaseConnectionError
          ? error.details
          : error instanceof Error
          ? error.message
          : String(error)
      );

      if (attempt < maxRetries) {
        const delay = Math.pow(2, attempt - 1) * 1000; // Exponential backoff
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }

  throw new DatabaseConnectionError(
    'ECONNFAIL',
    `Failed to connect after ${maxRetries} attempts: ${lastError?.message}`
  );
}

function handleConnectionError(error: Error): DatabaseConnectionError {
  const message = error.message.toLowerCase();

  if (message.includes('ssl')) {
    return new DatabaseConnectionError(
      'ETLSFAIL',
      'TLS/SSL connection failed - verify server certificate and client credentials'
    );
  }

  if (message.includes('econnrefused')) {
    return new DatabaseConnectionError(
      'ECONNREFUSED',
      `Connection refused - is PostgreSQL running on the configured host/port?`
    );
  }

  if (message.includes('ehostunreach')) {
    return new DatabaseConnectionError(
      'EHOSTUNREACH',
      'Database host unreachable - check network connectivity and firewall rules'
    );
  }

  if (message.includes('etimeout')) {
    return new DatabaseConnectionError(
      'ETIMEDOUT',
      'Connection timeout - database server may be overloaded or network is slow'
    );
  }

  if (message.includes('authentication')) {
    return new DatabaseConnectionError(
      'EAUTH',
      'Authentication failed - verify username, password, and role has login permission'
    );
  }

  return new DatabaseConnectionError(
    'EUNKNOWN',
    error.message
  );
}
```

### Monitoring and Auditing

#### Connection Log Monitoring
```sql
-- Monitor database connections and role usage
CREATE VIEW active_connections AS
SELECT
  pid,
  usename,
  application_name,
  client_addr,
  state,
  query_start,
  state_change,
  ssl,
  client_cert_digest,
  query
FROM pg_stat_activity
WHERE datname = 'lumigift'
  AND pid <> pg_backend_pid()
ORDER BY query_start DESC;

-- Query to check all active connections
SELECT * FROM active_connections;

-- Monitor role privileges (audit log)
CREATE TABLE role_activity_log (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_name TEXT NOT NULL,
  connection_time TIMESTAMPTZ NOT NULL,
  client_ip INET NOT NULL,
  ssl_version TEXT,
  query_type TEXT,
  success BOOLEAN,
  error_message TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Trigger to log all connections
CREATE OR REPLACE FUNCTION log_role_activity()
RETURNS void AS $$
BEGIN
  INSERT INTO role_activity_log (
    role_name,
    connection_time,
    client_ip,
    ssl_version,
    success
  ) SELECT
    current_user,
    now(),
    inet_client_addr(),
    ssl_version,
    true
  FROM pg_stat_ssl
  WHERE pid = pg_backend_pid();
END;
$$ LANGUAGE plpgsql;
```

#### Alerting Configuration
```typescript
// src/server/monitoring/db-alerts.ts

export async function monitorDatabaseHealth(): Promise<void> {
  const interval = setInterval(async () => {
    try {
      // Check app role connectivity
      await checkRoleConnection('app');
      
      // Check TLS enforcement
      await verifyTlsEnforcement();
      
      // Check connection pool health
      await checkConnectionPoolHealth();
      
      // Monitor for failed authentication attempts
      await checkAuthenticationFailures();
      
    } catch (error) {
      console.error('Database health check failed:', error);
      
      // Send alert to monitoring system
      await sendAlert({
        severity: 'CRITICAL',
        title: 'Database Health Check Failed',
        details: error instanceof Error ? error.message : String(error)
      });
    }
  }, 60000); // Check every minute
  
  return () => clearInterval(interval);
}

async function verifyTlsEnforcement(): Promise<void> {
  // Query to verify pg_hba.conf requires SSL
  const result = await query(
    "SELECT * FROM pg_settings WHERE name = 'ssl' AND setting = 'on'"
  );
  
  if (result.rows.length === 0) {
    throw new Error('TLS is not enabled on database server');
  }
}

async function checkConnectionPoolHealth(): Promise<void> {
  const result = await query(
    'SELECT count(*) as connection_count FROM pg_stat_activity WHERE datname = $1',
    ['lumigift']
  );
  
  const connectionCount = result.rows[0].connection_count;
  const maxConnections = 100; // Set based on your pool config
  
  if (connectionCount > maxConnections * 0.8) {
    throw new Error(
      `Connection pool usage high: ${connectionCount}/${maxConnections}`
    );
  }
}

async function checkAuthenticationFailures(): Promise<void> {
  // Query PostgreSQL log for authentication failures
  const result = await query(`
    SELECT COUNT(*) as failure_count
    FROM pg_log
    WHERE message LIKE 'authentication failed%'
    AND timestamp > now() - interval '5 minutes'
  `);
  
  if (result.rows[0].failure_count > 5) {
    throw new Error(
      `Multiple authentication failures detected in last 5 minutes`
    );
  }
}
```

### Deployment Checklist

- [ ] Create migration role with time-limited password and permissions
- [ ] Run all migrations using migration role
- [ ] Create application role with SELECT, INSERT, UPDATE, DELETE only
- [ ] Create reporting role with SELECT-only permissions
- [ ] Create backup role with SELECT-only permissions
- [ ] Revoke migration role after migrations complete
- [ ] Verify all roles cannot execute DDL (ALTER TABLE, CREATE, DROP)
- [ ] Enable TLS/SSL on PostgreSQL server
- [ ] Configure pg_hba.conf to require SSL for remote connections
- [ ] Distribute client certificates (CA, cert, key) to application servers
- [ ] Update DATABASE_URL to include `sslmode=require`
- [ ] Test connection failures produce explicit error messages
- [ ] Set up monitoring for failed authentication attempts
- [ ] Set up monitoring for TLS connection failures
- [ ] Verify connection pool health metrics
- [ ] Document role rotation schedule
- [ ] Schedule quarterly password rotation for all roles
- [ ] Create runbook for emergency database access (superuser)

### Migration Procedure

```bash
#!/bin/bash
# migrate-database.sh

set -e

echo "🔒 Starting secure database migration..."

# 1. Create roles
echo "Creating database roles..."
psql -U postgres -d lumigift -f scripts/create-roles.sql

# 2. Set passwords (should come from environment variables)
echo "Setting role passwords..."
psql -U postgres -d lumigift -c \
  "ALTER ROLE lumigift_app WITH PASSWORD '$DATABASE_APP_PASSWORD';"
psql -U postgres -d lumigift -c \
  "ALTER ROLE lumigift_reporting WITH PASSWORD '$DATABASE_REPORTING_PASSWORD';"
psql -U postgres -d lumigift -c \
  "ALTER ROLE lumigift_backup WITH PASSWORD '$DATABASE_BACKUP_PASSWORD';"

# 3. Run migrations as migration role
echo "Running migrations..."
psql -U lumigift_migration -d lumigift -f migrations/0001_init.sql
psql -U lumigift_migration -d lumigift -f migrations/0002_users.sql
psql -U lumigift_migration -d lumigift -f migrations/0003_gifts.sql

# 4. Revoke migration role
echo "Revoking migration role..."
psql -U postgres -d lumigift -f scripts/revoke-migration-role.sql

# 5. Verify permissions
echo "Verifying role permissions..."
psql -U lumigift_app -d lumigift -c "SELECT 1;" || exit 1

echo "✓ Database migration completed successfully"
```
