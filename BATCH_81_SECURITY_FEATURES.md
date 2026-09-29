# Batch-81: Security Features Implementation

Comprehensive documentation for security features addressing issues #139, #140, #142, and #143.

---

## Issue #139: Security Headers and Content Security Policy

### HTTP Security Headers Configuration

#### HSTS (Strict-Transport-Security)
```typescript
// next.config.mjs
export default {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          {
            key: 'Strict-Transport-Security',
            value: 'max-age=31536000; includeSubDomains; preload'
          }
        ]
      }
    ];
  }
};
```

**Details:**
- `max-age=31536000`: 1 year, forces HTTPS
- `includeSubDomains`: Applies to all subdomains
- `preload`: Enables inclusion in HSTS preload list

#### X-Frame-Options (Clickjacking Protection)
```typescript
{
  key: 'X-Frame-Options',
  value: 'DENY'
}
```

**Options:**
- `DENY`: Page cannot be displayed in frame/iframe
- Alternative: `SAMEORIGIN` (only same origin frames allowed)
- Prevents clickjacking attacks where attacker overlays button

#### X-Content-Type-Options (MIME Sniffing)
```typescript
{
  key: 'X-Content-Type-Options',
  value: 'nosniff'
}
```

**Effect:** Browser must honor Content-Type header, no MIME sniffing
- Prevents IE from executing CSS as JavaScript
- Prevents misinterpreted file uploads

#### Referrer-Policy
```typescript
{
  key: 'Referrer-Policy',
  value: 'strict-origin-when-cross-origin'
}
```

**Behavior:**
- Same-site requests: Full referrer sent
- Cross-site requests: Only origin sent (no path/query)
- Reduces information leakage to external sites

#### Permissions-Policy (Feature Policy)
```typescript
{
  key: 'Permissions-Policy',
  value: 'camera=(), microphone=(), geolocation=(), payment=(self), usb=()'
}
```

**Disabled Features:**
- `camera=()`: No camera access
- `microphone=()`: No microphone access
- `geolocation=()`: No location access
- `usb=()`: No USB access

**Allowed:**
- `payment=(self)`: Payment API only on our domain

#### X-Permitted-Cross-Domain-Policies
```typescript
{
  key: 'X-Permitted-Cross-Domain-Policies',
  value: 'none'
}
```

**Effect:** Flash/PDF plugins cannot read cross-domain policies

### Content Security Policy (CSP)

#### CSP Header Implementation
```typescript
// src/middleware.ts
function generateCSPHeader(): string {
  const nonce = generateNonce(); // Cryptographically random value
  
  return [
    // Default directive applies to all fetch directives
    `default-src 'self'`,
    
    // Script policy with nonce for inline scripts
    `script-src 'self' 'nonce-${nonce}' https://cdn.jsdelivr.net`,
    
    // Style policy
    `style-src 'self' 'nonce-${nonce}' https://fonts.googleapis.com`,
    
    // Font policy
    `font-src 'self' https://fonts.gstatic.com data:`,
    
    // Image policy - allow data URIs and common CDNs
    `img-src 'self' data: https: blob:`,
    
    // External API calls
    `connect-src 'self' https://horizon.stellar.org https://rpc.sorobanrpc.com`,
    
    // Form submission
    `form-action 'self'`,
    
    // Framing policy
    `frame-ancestors 'none'`,
    
    // Base URI restriction
    `base-uri 'self'`,
    
    // Reporting (optional)
    `report-uri https://your-domain.com/api/csp-report`,
    `report-to csp-endpoint`,
    
    // Upgrade insecure requests to HTTPS
    `upgrade-insecure-requests`
  ].join('; ');
}

export async function middleware(req: NextRequest) {
  const response = NextResponse.next();
  const cspHeader = generateCSPHeader();
  
  response.headers.set('Content-Security-Policy', cspHeader);
  response.headers.set('Content-Security-Policy-Report-Only', cspHeader);
  
  return response;
}
```

#### Nonce Generation
```typescript
// src/lib/nonce.ts
import { generateRandomString } from 'crypto';

export function generateNonce(): string {
  return generateRandomString(32, 'hex');
}

// src/app/layout.tsx
export default function RootLayout({ children }: { children: React.ReactNode }) {
  const nonce = generateNonce();
  
  return (
    <html>
      <head>
        <script nonce={nonce}>
          // Inline scripts must include nonce attribute
          window.config = { /* ... */ };
        </script>
      </head>
      <body>{children}</body>
    </html>
  );
}
```

#### CSP Rollout Strategy

**Phase 1: Report-Only (Days 1-7)**
```typescript
// Monitor violations without blocking
response.headers.set(
  'Content-Security-Policy-Report-Only',
  generateCSPHeader()
);
```

**Phase 2: Monitoring Dashboard (Days 7-14)**
```typescript
// CSP report handler to collect violations
export async function POST(req: NextRequest) {
  const report = await req.json();
  
  await db.cspViolations.create({
    data: {
      blockedUri: report['blocked-uri'],
      violatedDirective: report['violated-directive'],
      documentUri: report['document-uri'],
      sourceFile: report['source-file'],
      lineNumber: report['line-number'],
      columnNumber: report['column-number'],
      status: report['status-code'],
      userAgent: req.headers.get('user-agent'),
      timestamp: new Date()
    }
  });
  
  return NextResponse.json({ status: 'ok' });
}
```

**Phase 3: Enforce (Day 15+)**
```typescript
response.headers.set('Content-Security-Policy', generateCSPHeader());
```

**Monitoring Metrics:**
- Violations per directive
- Top blocked resources
- Client environments with issues
- Recommend changes based on violations

---

## Issue #140: SSRF and Outbound URL Handling

### SSRF (Server-Side Request Forgery) Threat

**Attack Vectors:**
```
1. Attacker provides internal IP: http://127.0.0.1:5432 (database)
2. Attacker provides private network: http://192.168.1.1 (router)
3. Attacker provides metadata service: http://169.254.169.254 (AWS)
4. Attacker provides DNS rebinding: resolve to internal IP
5. Attacker provides open redirect: http://external.com → http://internal
```

### Approved Configuration with Constraints

#### Stellar Horizon Configuration
```typescript
// src/server/config/stellar.ts
const APPROVED_STELLAR_HOSTS = {
  'testnet': 'https://horizon-testnet.stellar.org',
  'public': 'https://horizon.stellar.org'
};

const APPROVED_STELLAR_PORTS = new Set([443]); // HTTPS only

export function validateStellarUrl(hostname: string): boolean {
  const url = new URL(APPROVED_STELLAR_HOSTS[process.env.STELLAR_NETWORK!]);
  return hostname === url.hostname;
}
```

#### Soroban RPC Configuration
```typescript
const APPROVED_RPC_HOSTS = {
  'testnet': 'https://soroban-testnet.stellar.org',
  'public': 'https://soroban.stellar.org'
};

const APPROVED_RPC_PORTS = new Set([443]); // HTTPS only

export function validateRpcUrl(hostname: string): boolean {
  const url = new URL(APPROVED_RPC_HOSTS[process.env.STELLAR_NETWORK!]);
  return hostname === url.hostname;
}
```

#### Payment Provider Webhooks
```typescript
const APPROVED_WEBHOOK_ORIGINS = new Map([
  ['paystack', new Set([
    'https://api.paystack.co',
    'https://events.paystack.co'
  ])],
  ['stripe', new Set([
    'https://api.stripe.com',
    'https://events.stripe.com'
  ])]
]);

function validateWebhookOrigin(provider: string, origin: string): boolean {
  const allowed = APPROVED_WEBHOOK_ORIGINS.get(provider);
  if (!allowed) return false;
  
  try {
    const url = new URL(origin);
    return allowed.has(url.origin);
  } catch {
    return false;
  }
}
```

### URL Validation Function

```typescript
// src/lib/url-validation.ts
import { URL } from 'url';

interface UrlValidationConfig {
  allowedHosts: Set<string>;
  allowedPorts?: Set<number>;
  requireHttps: boolean;
  timeout: number;
  maxResponseSize: number;
}

export function validateOutboundUrl(
  urlString: string,
  config: UrlValidationConfig
): URL {
  let url: URL;
  
  try {
    url = new URL(urlString);
  } catch {
    throw new Error('Invalid URL format');
  }

  // 1. Protocol validation
  if (config.requireHttps && url.protocol !== 'https:') {
    throw new Error('HTTPS required');
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error('Only HTTP/HTTPS allowed');
  }

  // 2. Hostname validation - block private/internal IPs
  const hostname = url.hostname;
  
  if (isPrivateIP(hostname)) {
    throw new Error(`Private IP not allowed: ${hostname}`);
  }
  
  if (isMetadataService(hostname)) {
    throw new Error(`Metadata service blocked: ${hostname}`);
  }

  // 3. Whitelist validation
  if (!config.allowedHosts.has(hostname)) {
    throw new Error(`Host not approved: ${hostname}`);
  }

  // 4. Port validation
  const port = url.port ? parseInt(url.port) : (url.protocol === 'https:' ? 443 : 80);
  if (config.allowedPorts && !config.allowedPorts.has(port)) {
    throw new Error(`Port not allowed: ${port}`);
  }

  return url;
}

function isPrivateIP(hostname: string): boolean {
  // Check for private IP ranges
  const privateRanges = [
    /^127\./,                    // Loopback
    /^10\./,                     // Private A
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // Private B
    /^192\.168\./,               // Private C
    /^169\.254\./,               // Link-local
    /^fc00:/,                    // Unique local (IPv6)
    /^fe80:/,                    // Link-local (IPv6)
    /^::1$/                      // Loopback (IPv6)
  ];
  
  return privateRanges.some(range => range.test(hostname));
}

function isMetadataService(hostname: string): boolean {
  const blocked = [
    '169.254.169.254',           // AWS metadata
    '169.254.169.253',           // Azure metadata
    'metadata.google.internal',  // GCP metadata
    'localhost',
    '0.0.0.0',
    '255.255.255.255'
  ];
  
  return blocked.includes(hostname) || 
         hostname.startsWith('metadata.') ||
         hostname.includes('internal');
}
```

### Timeouts and Size Limits

```typescript
// src/lib/safe-fetch.ts
export interface SafeFetchOptions {
  timeout?: number;
  maxResponseSize?: number;
}

const DEFAULT_TIMEOUT = 10_000;        // 10 seconds
const DEFAULT_MAX_SIZE = 10 * 1024 * 1024; // 10 MB

export async function safeFetch(
  url: URL,
  config: UrlValidationConfig,
  options: SafeFetchOptions = {}
): Promise<Response> {
  const timeout = options.timeout ?? DEFAULT_TIMEOUT;
  const maxSize = options.maxResponseSize ?? DEFAULT_MAX_SIZE;

  // Validate URL before fetching
  validateOutboundUrl(url.toString(), config);

  // Create AbortController for timeout
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  try {
    const response = await fetch(url.toString(), {
      signal: controller.signal,
      headers: {
        'User-Agent': `Lumigift/1.0 (${process.env.NODE_ENV})`
      }
    });

    // Check response size before reading
    const contentLength = response.headers.get('content-length');
    if (contentLength && parseInt(contentLength) > maxSize) {
      throw new Error(`Response too large: ${contentLength} bytes`);
    }

    // Read response with size limit
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > maxSize) {
      throw new Error(`Response exceeded size limit: ${buffer.byteLength} bytes`);
    }

    return new Response(buffer, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers
    });
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new Error(`Request timeout after ${timeout}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timeoutId);
  }
}
```

### Usage in Application

```typescript
// src/server/services/stellar.service.ts
export class StellarService {
  private horizonConfig: UrlValidationConfig = {
    allowedHosts: new Set(['horizon-testnet.stellar.org']),
    allowedPorts: new Set([443]),
    requireHttps: true,
    timeout: 30_000,
    maxResponseSize: 1_000_000
  };

  async getAccount(accountId: string): Promise<Account> {
    const url = new URL(process.env.STELLAR_HORIZON_URL!);
    url.pathname = `/accounts/${accountId}`;

    const response = await safeFetch(url, this.horizonConfig);
    return response.json();
  }
}

// src/server/services/payment.service.ts
export class PaymentService {
  async fetchTransactionStatus(reference: string): Promise<Transaction> {
    // Use approved provider URL only
    const url = new URL('https://api.paystack.co/transaction/verify/' + reference);
    
    const response = await safeFetch(url, {
      allowedHosts: new Set(['api.paystack.co']),
      allowedPorts: new Set([443]),
      requireHttps: true,
      timeout: 10_000,
      maxResponseSize: 1_000_000
    });

    return response.json();
  }
}
```

---

## Issue #142: Dependency License and Vulnerability Governance

### SBOM (Software Bill of Materials) Generation

#### CycloneDX SBOM
```typescript
// scripts/generate-sbom.ts
import { execSync } from 'child_process';
import * as fs from 'fs';

export function generateSBOM(): void {
  // Generate CycloneDX format
  const sbom = execSync('npm sbom --format=cyclonedx', {
    encoding: 'utf-8'
  });

  fs.writeFileSync(
    'dist/sbom.json',
    JSON.stringify(JSON.parse(sbom), null, 2)
  );

  console.log('✓ SBOM generated at dist/sbom.json');
}

// package.json
{
  "scripts": {
    "sbom": "ts-node scripts/generate-sbom.ts"
  }
}
```

### Vulnerability Scanning

#### npm audit Integration
```bash
# In CI/CD pipeline
npm audit --json > audit-report.json

# Exit with failure if critical found
npm audit --audit-level=critical
```

#### Snyk Integration (Alternative)
```bash
npm install -g snyk
snyk auth
snyk test --json > snyk-report.json
snyk monitor  # Continuous monitoring
```

### License Governance

#### License Policy Configuration
```typescript
// license-policy.json
{
  "approved": [
    "MIT",
    "Apache-2.0",
    "BSD-2-Clause",
    "BSD-3-Clause",
    "ISC",
    "GPL-3.0-or-later"
  ],
  "restricted": [
    "AGPL-3.0",
    "GPL-2.0-only"
  ],
  "exceptions": [
    {
      "package": "optional-dependency",
      "license": "Restricted-License",
      "reason": "Only used in optional feature",
      "expiry": "2026-12-31",
      "owner": "security-team@example.com"
    }
  ]
}
```

#### License Validation
```typescript
// scripts/validate-licenses.ts
import { execSync } from 'child_process';
import * as fs from 'fs';

interface LicenseConfig {
  approved: string[];
  restricted: string[];
  exceptions: Array<{
    package: string;
    license: string;
    reason: string;
    expiry: string;
    owner: string;
  }>;
}

export function validateLicenses(): void {
  const policy: LicenseConfig = JSON.parse(
    fs.readFileSync('license-policy.json', 'utf-8')
  );

  const licenses = execSync('npm ls --json --depth=0', {
    encoding: 'utf-8'
  });

  const parsed = JSON.parse(licenses);
  const violations: string[] = [];

  for (const [pkg, info] of Object.entries(parsed.dependencies || {})) {
    const licenseStr = (info as any).resolved;
    const license = extractLicense(licenseStr);

    // Check against policy
    if (policy.restricted.includes(license)) {
      // Check if exception exists
      const exception = policy.exceptions.find(e => e.package === pkg);
      
      if (!exception) {
        violations.push(`❌ ${pkg}: Restricted license (${license})`);
      } else if (new Date(exception.expiry) < new Date()) {
        violations.push(
          `⏰ ${pkg}: Exception expired (expires: ${exception.expiry})`
        );
      } else {
        console.log(`✅ ${pkg}: Exception valid until ${exception.expiry}`);
      }
    } else if (!policy.approved.includes(license)) {
      violations.push(`⚠️ ${pkg}: Unknown license (${license})`);
    }
  }

  if (violations.length > 0) {
    console.error('License policy violations:');
    violations.forEach(v => console.error(v));
    process.exit(1);
  }

  console.log('✓ All licenses approved');
}

function extractLicense(pkgStr: string): string {
  // Extract from package.json resolved field
  return 'MIT'; // Simplified
}
```

### Critical Vulnerability Blocking

#### GitHub Branch Protection Rule
```yaml
# .github/workflows/security-check.yml
name: Security Checks

on:
  pull_request:
    branches: [main]
  schedule:
    - cron: '0 0 * * 0'  # Weekly

jobs:
  vulnerabilities:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      
      - name: npm audit
        run: |
          npm audit --json > audit-report.json
          npm audit --audit-level=critical
      
      - name: License check
        run: npx license-checker --json > licenses.json
      
      - name: Generate SBOM
        run: npm sbom --format=cyclonedx > sbom.json
      
      - uses: actions/upload-artifact@v3
        with:
          name: security-reports
          path: |
            audit-report.json
            licenses.json
            sbom.json
```

### Exception Management

```sql
CREATE TABLE vulnerability_exceptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  cve_id TEXT NOT NULL,
  package TEXT NOT NULL,
  reason TEXT NOT NULL,
  approved_by TEXT NOT NULL,
  approved_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL,
  UNIQUE(cve_id, package)
);

-- Alert when exception expires in 14 days
SELECT * FROM vulnerability_exceptions
WHERE expires_at < now() + interval '14 days'
AND expires_at > now();
```

---

## Issue #143: External Smart Contract Security Review

### Pre-Review Checklist

#### Contract Audit Scope
```markdown
## Contracts to Review
- Escrow contract (locking/releasing USDC)
- Gift factory contract (state management)
- Payment splitter (revenue distribution)

## Review Areas
1. Authorization checks
2. Token handling (USDC transfer logic)
3. Time-based controls (TTL, expiry)
4. Upgrade mechanisms
5. Refund paths
```

### Security Audit Framework

#### Test Coverage Requirements
```typescript
// tests/escrow-contract.test.ts

describe('Escrow Contract Security', () => {
  describe('Authorization', () => {
    it('should reject gift lock from unauthorized caller', async () => {
      const attacker = Keypair.random();
      const result = await escrow.lock({
        giftId: 'gift-123',
        amount: '100',
        recipient: recipientAddress,
        invoker: attacker.publicKey()
      });
      expect(result).toThrow('NotAuthorized');
    });

    it('should only allow escrow contract to call release', async () => {
      // Only the authorized admin key should release
      expect(await escrow.release({ giftId })).toSucceed();
    });
  });

  describe('Token Handling', () => {
    it('should transfer exact amount without rounding loss', async () => {
      const amount = '123456789'; // 123.456789 USDC
      await escrow.lock({ amount, recipientWallet });
      const released = await escrow.release({ giftId });
      expect(released).toBe(amount);
    });

    it('should prevent reentrancy attacks', async () => {
      // Recursive call should fail
      const result = await escrow.release({ giftId });
      const reentry = await result.release({ giftId });
      expect(reentry).toThrow('AlreadyProcessing');
    });
  });

  describe('TTL and Expiry', () => {
    it('should reject release after expiry timestamp', async () => {
      const expiry = Math.floor(Date.now() / 1000); // Already expired
      const result = await escrow.release({
        giftId,
        expiry,
        invoker: admin.publicKey()
      });
      expect(result).toThrow('ExpiredGift');
    });

    it('should allow refund after expiry', async () => {
      const expiry = Math.floor(Date.now() / 1000) - 86400; // 1 day ago
      const refund = await escrow.refund({ giftId, expiry });
      expect(refund).toSucceed();
    });
  });

  describe('Upgrade Mechanism', () => {
    it('should prevent unauthorized upgrade', async () => {
      const attacker = Keypair.random();
      const newCode = Buffer.from('malicious');
      const result = await escrow.upgrade({
        newCode,
        invoker: attacker.publicKey()
      });
      expect(result).toThrow('NotAdmin');
    });

    it('should only allow admin to upgrade', async () => {
      const newCode = Buffer.from('legitimate');
      const result = await escrow.upgrade({
        newCode,
        invoker: admin.publicKey()
      });
      expect(result).toSucceed();
    });
  });

  describe('Refund Paths', () => {
    it('should refund to sender on cancellation', async () => {
      const senderBalance = await usdc.balance(sender.publicKey());
      await escrow.cancel({ giftId, invoker: sender.publicKey() });
      const newBalance = await usdc.balance(sender.publicKey());
      expect(newBalance).toBe(senderBalance.add(amount));
    });

    it('should prevent double-refund', async () => {
      await escrow.cancel({ giftId, invoker: sender.publicKey() });
      const result = await escrow.cancel({
        giftId,
        invoker: sender.publicKey()
      });
      expect(result).toThrow('AlreadyRefunded');
    });

    it('should fail refund if claimed', async () => {
      await escrow.release({ giftId, invoker: admin.publicKey() });
      const result = await escrow.cancel({
        giftId,
        invoker: sender.publicKey()
      });
      expect(result).toThrow('AlreadyClaimed');
    });
  });
});
```

### Audit Report Documentation

#### Report Structure
```markdown
# Lumigift Smart Contract Security Audit Report

**Auditor:** [Security Firm Name]
**Date:** 2026-09-29
**Contracts Reviewed:**
- Escrow Contract (v1.0.0)
- Gift Factory Contract (v1.0.0)

## Executive Summary
[Overall risk assessment and findings count]

## Critical Findings
### Finding C-1: Reentrancy in Release Function
- **Location:** escrow/src/lib.rs:145
- **Severity:** CRITICAL
- **Description:** Contract calls external token transfer before state update
- **Mitigation:** Implement checks-effects-interactions pattern
- **Status:** OPEN

## High-Risk Findings
### Finding H-1: Missing TTL Validation
- **Location:** gift-factory/src/lib.rs:89
- **Severity:** HIGH
- **Description:** Gift expiry not validated against block timestamp
- **Mitigation:** Add timestamp check before release authorization
- **Status:** OPEN

## Medium-Risk Findings
[Similar format for medium findings]

## Low-Risk Findings
[Similar format for low findings]

## Recommendations
1. Implement formal verification for escrow contract
2. Add circuit breaker pattern for emergency stops
3. Create monitoring for unusual claim patterns

## Testing Coverage
- Unit tests: 95%
- Integration tests: 87%
- Property-based tests: Missing (RECOMMENDED)

## Conclusion
Contract is suitable for testnet deployment with critical findings fixed.
Not recommended for mainnet until high-risk findings resolved.
```

### Findings Management

```typescript
// src/server/audit-findings.ts

interface AuditFinding {
  id: string;
  findingNumber: string;  // C-1, H-1, M-1, L-1
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW';
  title: string;
  description: string;
  location: string;        // contract/src/file.rs:line
  mitigation: string;
  status: 'OPEN' | 'FIXED' | 'WONTFIX' | 'DEFERRED';
  evidence: string;        // Link to commit/test
  createdAt: Date;
}

export async function logFinding(
  finding: Omit<AuditFinding, 'id' | 'createdAt'>
): Promise<AuditFinding> {
  return db.auditFindings.create({
    data: {
      ...finding,
      createdAt: new Date()
    }
  });
}

export async function closeFinding(
  findingId: string,
  status: 'FIXED' | 'WONTFIX' | 'DEFERRED',
  evidence: string
): Promise<AuditFinding> {
  return db.auditFindings.update({
    where: { id: findingId },
    data: { status, evidence }
  });
}
```

### Audit Archive

```typescript
// Archive deployed contract code and audit report
export async function archiveDeployment(network: 'testnet' | 'mainnet') {
  const timestamp = new Date().toISOString();
  const contractHash = await getDeployedHash(network);
  
  const archive = {
    network,
    deployedAt: timestamp,
    contractHash,
    auditReportUrl: `https://audits.lumigift.com/${contractHash}.pdf`,
    testResults: await loadTestResults(),
    sbom: await loadSBOM()
  };

  await db.deploymentArchive.create({ data: archive });
  
  return archive;
}
```

---

## Deployment Checklist

### Pre-Deployment (Issue #142)
- [ ] Generate SBOM in CycloneDX format
- [ ] Run npm audit and resolve all critical vulnerabilities
- [ ] Validate license policy with no restricted licenses
- [ ] Create vulnerability exceptions with expiry dates
- [ ] Set up GitHub branch protection rule requiring security checks
- [ ] Document all dependency versions in SBOM

### CSP Rollout (Issue #139)
- [ ] Deploy CSP Report-Only header
- [ ] Monitor for 7 days and collect violations
- [ ] Fix critical violations (scripts, styles)
- [ ] Transition to enforcement mode
- [ ] Monitor CSP reports in production

### SSRF Prevention (Issue #140)
- [ ] Define approved hosts for Stellar Horizon
- [ ] Define approved hosts for Soroban RPC
- [ ] Define approved hosts for payment providers
- [ ] Implement URL validation middleware
- [ ] Add timeouts to all outbound requests (10s)
- [ ] Set response size limits (10MB default)

### Smart Contract Review (Issue #143)
- [ ] Select and contract with security auditor
- [ ] Provide contract source code and test suite
- [ ] Receive audit report within 14 days
- [ ] Close critical findings with evidence
- [ ] Archive audit report with deployed contract hash
- [ ] Deploy to testnet only until audit complete
- [ ] Obtain security sign-off before mainnet

## Testing Requirements
- [ ] Integration tests for SSRF blocking
- [ ] Unit tests for CSP nonce generation
- [ ] Smoke tests for all approved outbound endpoints
- [ ] Contract security tests for escrow contract
- [ ] Vulnerability management workflow tests
