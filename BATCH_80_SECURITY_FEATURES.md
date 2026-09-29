# Batch-80: Security Features Implementation

Comprehensive documentation for security features addressing issues #132, #133, #137, and #138.

---

## Issue #132: Threat Model - Money Movement and Identity Flows

### Assets
- **USDC**: Digital currency locked in escrow contracts
- **NGN**: Fiat currency in payment processor integration
- **User Identity**: Profile data, email, phone, KYC information
- **Sender Authentication**: Session tokens and API credentials
- **Gift Data**: Amount, recipient identifier, expiry, status

### Actors
- **Gift Sender**: Authenticated user initiating fund transfer
- **Gift Recipient**: Identified by phone/email, claims gift
- **Admin**: Platform operator with elevated permissions
- **Payment Processor**: Paystack/Stripe integration
- **Stellar Network**: Smart contract executor
- **Attacker**: Unauthorized party attempting fraud

### Boundaries
- **Trust Boundary 1**: Client browser → Next.js API endpoints
- **Trust Boundary 2**: Next.js backend → Database
- **Trust Boundary 3**: Platform → Stellar network
- **Trust Boundary 4**: Platform → Payment processors
- **Trust Boundary 5**: Platform → User devices (SMS/email delivery)

### Critical Flows

#### Flow 1: Gift Creation (NGN Payment)
```
Sender: Browser → API POST /gifts
API: Create gift record (status=pending)
API: Initiate payment with Paystack
Paystack: Charge sender's bank account
Paystack: Webhook POST /webhooks/paystack
API: Verify webhook signature & nonce
API: Update gift (status=funded)
```

**Threats:**
- T1.1: Attacker replays webhook → gift claimed twice
  - Mitigation: Store consumed webhook IDs, verify replay nonce
- T1.2: Attacker spoofs webhook from payment processor
  - Mitigation: Verify webhook signature using Paystack public key
- T1.3: Attacker modifies amount in webhook
  - Mitigation: Verify amount matches gift record before claiming
- T1.4: Gift amount exceeds regulatory limit
  - Mitigation: Validate amount against MAX_GIFT_AMOUNT at creation time

#### Flow 2: Identity Verification (Recipient)
```
Recipient: Receives SMS/email with claim link
Recipient: Accesses link with token: /claim?token=xyz
API: Validate token (TTL=7 days, one-time use)
API: Verify phone/email matches gift recipient
API: Create claim request (status=verifying)
```

**Threats:**
- T2.1: Attacker intercepts SMS → claims gift as imposter
  - Mitigation: Require OTP on claim, verify phone possession
- T2.2: Attacker brute-forces claim token
  - Mitigation: Use cryptographically random tokens (256-bit), rate limit verification
- T2.3: Token replay → claim same gift twice
  - Mitigation: Mark token as consumed, one-time use only

#### Flow 3: Fund Release (Stellar)
```
Recipient: Verified and approved for fund release
API: Query escrow contract for gift USDC
API: Unlock USDC to recipient wallet
Stellar: Execute release transaction
Recipient: USDC appears in wallet
```

**Threats:**
- T3.1: Attacker triggers early release before verification
  - Mitigation: Require verified status, audit log before release
- T3.2: Recipient wallet is compromised
  - Mitigation: Send to wallet provided at claim time only
- T3.3: Double-spend: Release funds and refund simultaneously
  - Mitigation: Atomic state transitions, check status before release

#### Flow 4: Cancellation & Refund
```
Sender: Requests cancellation if expiry or recipient not found
API: Check gift expiry date and claim status
API: Unlock USDC from escrow back to sender
Paystack: Process refund to sender's bank account
```

**Threats:**
- T4.1: Attacker cancels gift after claiming
  - Mitigation: Lock status to claimed, prevent refund if claimed
- T4.2: Race condition: Simultaneous claim and cancel
  - Mitigation: Database transaction with SELECT FOR UPDATE on gift record

### High-Risk Threats Requiring Controls

| Threat | Severity | Control |
|--------|----------|---------|
| Webhook replay (T1.1) | CRITICAL | Unique nonce per webhook, consumed ID tracking |
| Webhook spoofing (T1.2) | CRITICAL | Cryptographic signature verification (HMAC-SHA256) |
| Token replay (T2.3) | HIGH | One-time use enforcement, token revocation |
| Double-spend (T3.3) | CRITICAL | Atomic transactions, status machine enforcement |
| Race condition claim/cancel (T4.2) | HIGH | Row-level locking (SELECT FOR UPDATE) |
| Regulatory violation (T1.4) | MEDIUM | Amount validation at creation and claim |

### Testing Strategy
- Unit tests for state machine transitions
- Integration tests for webhook processing with consumed ID tracking
- Load tests for race condition scenarios
- Negative tests for amount validation limits

---

## Issue #133: Role-Based Access Control (RBAC) Data Model

### Roles Defined

```
enum Role {
  USER          // Regular user, can send/claim gifts
  ADMIN         // Platform admin, full access
  MODERATOR     // Review reports, manage users
  FRAUD_ANALYST // Investigate suspicious activity
  SUPPORT       // Help users, view audit logs
}
```

### Database Schema

#### roles table
```sql
CREATE TABLE roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT UNIQUE NOT NULL,
  description TEXT,
  permissions JSONB DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

#### role_assignments table
```sql
CREATE TABLE role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL REFERENCES users(id),
  role_id UUID NOT NULL REFERENCES roles(id),
  assigned_by TEXT REFERENCES users(id),
  assigned_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ,
  UNIQUE(user_id, role_id)
);
```

#### permission_checks (audit log)
```sql
CREATE TABLE permission_checks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  resource TEXT NOT NULL,
  decision TEXT CHECK (decision IN ('ALLOW', 'DENY')),
  checked_at TIMESTAMPTZ DEFAULT now()
);
```

### Least-Privilege Defaults

- **Default Role**: USER (read-only access to own gifts)
- **Admin Creation**: Requires existing ADMIN to approve
- **Role Expiry**: Support roles expire after 90 days, require renewal
- **Explicit Allow**: All actions require explicit permission grant

### Permission Matrix

| Action | USER | MODERATOR | ADMIN | FRAUD_ANALYST | SUPPORT |
|--------|------|-----------|-------|---------------|---------|
| Send gift | ✓ | ✓ | ✓ | ✗ | ✗ |
| Claim gift | ✓ | ✓ | ✓ | ✗ | ✗ |
| View own audit logs | ✓ | ✓ | ✓ | ✓ | ✗ |
| View all audit logs | ✗ | ✗ | ✓ | ✓ | ✓ |
| Suspend user | ✗ | ✓ | ✓ | ✗ | ✗ |
| Modify gift | ✗ | ✗ | ✓ | ✗ | ✗ |
| Manage roles | ✗ | ✗ | ✓ | ✗ | ✗ |
| View fraud reports | ✗ | ✓ | ✓ | ✓ | ✗ |

### Implementation in Middleware

```typescript
// src/middleware.ts enhancement
async function checkPermission(
  req: NextRequest,
  userId: string,
  action: string,
  resource: string
): Promise<boolean> {
  const assignments = await db.roleAssignments.findMany({
    where: { userId },
    include: { role: { include: { permissions: true } } }
  });

  const hasPermission = assignments.some(a =>
    a.role.permissions.some(p =>
      p.action === action && p.resource === resource
    )
  );

  // Log decision
  await auditService.logPermissionCheck({
    userId,
    action,
    resource,
    decision: hasPermission ? 'ALLOW' : 'DENY'
  });

  return hasPermission;
}
```

### Audit Requirements

- All role changes logged with assigned_by and timestamp
- Permission denials logged for security review
- Quarterly audit of admin access patterns
- Immediate alert on privilege escalation attempts

---

## Issue #137: Webhook Replay and Timestamp Controls

### Webhook Security Model

#### Signature Verification
```typescript
interface WebhookEvent {
  id: string;              // Unique event ID
  timestamp: number;       // Unix timestamp (seconds)
  nonce: string;          // Random value, 32 bytes hex
  event: string;          // Event type (e.g., 'payment.success')
  data: Record<string, unknown>;
  signature: string;      // HMAC-SHA256(payload, secret)
}
```

#### Processing Pipeline
```
1. Receive webhook POST
2. Verify timestamp within ±300 seconds (5 minutes)
3. Reconstruct payload for signature verification
4. Verify signature using provider's public key
5. Check nonce against consumed_webhook_nonces table
6. If nonce exists → reject (replay attempt)
7. If new → store nonce, process event, return 200
```

#### Consumed Nonce Tracking
```sql
CREATE TABLE consumed_webhook_nonces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  provider TEXT NOT NULL,  -- 'paystack', 'stripe', etc.
  nonce TEXT NOT NULL,
  event_id TEXT,
  consumed_at TIMESTAMPTZ DEFAULT now(),
  expires_at TIMESTAMPTZ DEFAULT now() + interval '24 hours',
  UNIQUE(provider, nonce)
);

-- Cleanup old nonces after 24 hours
CREATE INDEX consumed_nonces_expiry ON consumed_webhook_nonces(expires_at);
```

### Provider-Specific Implementations

#### Paystack
- **Secret**: Stored in `PAYSTACK_WEBHOOK_SECRET`
- **Signature Header**: `x-paystack-signature`
- **Signature Method**: HMAC-SHA512(raw_body, secret)
- **Timestamp**: `created_at` in payload
- **Verification URL**: Optional, can verify via API

#### Stripe
- **Secret**: Stored in `STRIPE_WEBHOOK_SECRET`
- **Signature Header**: `stripe-signature`
- **Format**: `t=timestamp,v1=signature`
- **Signature Method**: HMAC-SHA256(timestamp.payload, secret)
- **Timestamp**: `created` in event object (Unix timestamp)

### Replay Window Configuration
```typescript
const WEBHOOK_CONFIG = {
  paystack: {
    timeWindowSeconds: 300,      // 5 minutes
    signatureAlgorithm: 'sha512',
    nonceLength: 32
  },
  stripe: {
    timeWindowSeconds: 300,
    signatureAlgorithm: 'sha256',
    nonceLength: 32
  }
};
```

### Implementation: Route Handler
```typescript
// src/app/api/webhooks/paystack/route.ts
export async function POST(req: NextRequest) {
  const signature = req.headers.get('x-paystack-signature');
  const body = await req.text();

  // 1. Verify signature
  const hash = crypto
    .createHmac('sha512', process.env.PAYSTACK_WEBHOOK_SECRET!)
    .update(body)
    .digest('hex');
  
  if (hash !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 });
  }

  const event = JSON.parse(body);
  
  // 2. Verify timestamp (±5 minutes)
  const eventTime = new Date(event.data.created_at).getTime() / 1000;
  const now = Math.floor(Date.now() / 1000);
  if (Math.abs(now - eventTime) > 300) {
    return NextResponse.json({ error: 'Request too old' }, { status: 400 });
  }

  // 3. Check nonce (use event.reference as nonce)
  const existingNonce = await db.consumedWebhookNonce.findUnique({
    where: {
      provider_nonce: {
        provider: 'paystack',
        nonce: event.reference
      }
    }
  });

  if (existingNonce) {
    // Replay detected - log but return 200 to silence sender
    await auditService.logWebhookReplay({
      provider: 'paystack',
      nonce: event.reference,
      timestamp: new Date(event.data.created_at)
    });
    return NextResponse.json({ status: 'ok' });
  }

  // 4. Store nonce (consumed)
  await db.consumedWebhookNonce.create({
    data: {
      provider: 'paystack',
      nonce: event.reference,
      event_id: event.data.id,
      consumed_at: new Date(event.data.created_at),
      expires_at: new Date(Date.now() + 24 * 60 * 60 * 1000)
    }
  });

  // 5. Process event
  if (event.event === 'charge.success') {
    await giftService.processPayment({
      amount: event.data.amount / 100,
      reference: event.reference,
      giftId: event.data.metadata.gift_id
    });
  }

  return NextResponse.json({ status: 'ok' });
}
```

### Raw Request Bytes Verification
```typescript
// Middleware to preserve raw body for signature verification
export async function middleware(req: NextRequest) {
  if (req.nextUrl.pathname.startsWith('/api/webhooks/')) {
    // Preserve raw body before Next.js parses it
    req.rawBody = await req.arrayBuffer();
  }
  return NextResponse.next();
}
```

### Monitoring & Alerting
- Log all webhook rejections (invalid signature, replay, timeout)
- Alert on repeated failures from same provider
- Monitor webhook latency (should be <100ms)
- Track nonce table growth (cleanup job runs daily)

---

## Issue #138: Upload Authorization and Content Validation

### Upload Flow
```
User: POST /api/uploads
  - file: binary
  - owner: user_id
  - context: gift_id or profile

API: Validate authorization
  - Is requester the owner?
  - Is context valid (gift exists, user owns gift)?
  - Is upload disabled for this gift status?

API: Validate file
  - MIME type (whitelist: image/jpeg, image/png, image/webp)
  - File size (<5MB)
  - Pixel dimensions (max 4000x4000)
  - No embedded exploits (reprocess with ImageMagick)

API: Generate slug and upload to Cloudinary
  - Ownership: Store owner_id with object
  - Access control: Require auth + owner check to read

Client: Verify transformation before display
  - Trust only URLs served from CDN
  - Disable CORS for direct access
```

### Authorization Matrix
```sql
CREATE TABLE file_uploads (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id TEXT NOT NULL REFERENCES users(id),
  context_type TEXT NOT NULL CHECK (context_type IN ('gift', 'profile')),
  context_id TEXT NOT NULL,
  cloudinary_id TEXT UNIQUE NOT NULL,
  cloudinary_url TEXT,
  mime_type TEXT NOT NULL,
  file_size INTEGER NOT NULL,
  uploaded_at TIMESTAMPTZ DEFAULT now(),
  deleted_at TIMESTAMPTZ
);

-- Can only delete own uploads
-- Can only read if: owner OR admin OR recipient of gift with upload
```

### MIME Type Validation
```typescript
const ALLOWED_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp'
]);

const MIME_EXTENSIONS = new Map([
  ['image/jpeg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp']
]);

function validateMimeType(file: File, mimeType: string): boolean {
  // Check MIME type matches file extension
  const extension = file.name.split('.').pop()?.toLowerCase();
  const expectedExtension = MIME_EXTENSIONS.get(mimeType);
  
  if (extension !== expectedExtension) {
    throw new Error(`MIME type does not match file extension`);
  }

  // Use file-type library to verify actual content
  const buffer = await file.arrayBuffer();
  const type = await fileType(buffer);
  
  if (type?.mime !== mimeType) {
    throw new Error(`File content does not match declared MIME type`);
  }

  return true;
}
```

### Size and Dimension Validation
```typescript
const UPLOAD_LIMITS = {
  maxFileSize: 5 * 1024 * 1024,        // 5MB
  maxPixelWidth: 4000,
  maxPixelHeight: 4000,
  maxTotalPixels: 10_000_000           // 10MP
};

async function validateImageDimensions(
  buffer: Buffer
): Promise<{ width: number; height: number }> {
  const { width, height } = await sharp(buffer).metadata();
  
  if (width! > UPLOAD_LIMITS.maxPixelWidth) {
    throw new Error(`Image too wide: ${width}px > ${UPLOAD_LIMITS.maxPixelWidth}px`);
  }
  
  if (height! > UPLOAD_LIMITS.maxPixelHeight) {
    throw new Error(`Image too tall: ${height}px > ${UPLOAD_LIMITS.maxPixelHeight}px`);
  }
  
  if ((width! * height!) > UPLOAD_LIMITS.maxTotalPixels) {
    throw new Error(`Image resolution too high`);
  }

  return { width: width!, height: height! };
}
```

### Exploit Prevention: Image Reprocessing
```typescript
// Reprocess image to remove embedded EXIF, scripts, etc.
async function sanitizeImage(buffer: Buffer): Promise<Buffer> {
  return sharp(buffer)
    .rotate()                    // Auto-rotate based on EXIF
    .withMetadata(false)         // Strip all metadata
    .toFormat('jpeg', { quality: 85 })
    .toBuffer();
}
```

### Upload Handler
```typescript
// src/app/api/uploads/route.ts
export async function POST(req: NextRequest) {
  const user = await getSession(req);
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

  const formData = await req.formData();
  const file = formData.get('file') as File;
  const contextType = formData.get('contextType') as string;
  const contextId = formData.get('contextId') as string;

  // 1. Validate authorization
  if (contextType === 'gift') {
    const gift = await db.gift.findUnique({ where: { id: contextId } });
    if (!gift || gift.senderId !== user.id) {
      return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    }
    if (gift.status !== 'pending') {
      return NextResponse.json(
        { error: 'Cannot upload to funded/claimed gift' },
        { status: 400 }
      );
    }
  }

  // 2. Validate MIME type
  const mimeType = file.type;
  if (!ALLOWED_MIME_TYPES.has(mimeType)) {
    return NextResponse.json({ error: 'Invalid file type' }, { status: 400 });
  }

  const buffer = Buffer.from(await file.arrayBuffer());

  // 3. Validate size
  if (buffer.length > UPLOAD_LIMITS.maxFileSize) {
    return NextResponse.json({ error: 'File too large' }, { status: 400 });
  }

  // 4. Verify actual content matches declared MIME
  const type = await fileType(buffer);
  if (type?.mime !== mimeType) {
    return NextResponse.json({ error: 'File content mismatch' }, { status: 400 });
  }

  // 5. Validate dimensions
  await validateImageDimensions(buffer);

  // 6. Sanitize (reprocess image)
  const sanitized = await sanitizeImage(buffer);

  // 7. Upload to Cloudinary
  const result = await cloudinary.uploader.upload(sanitized, {
    folder: `lumigift/${contextType}/${contextId}`,
    resource_type: 'image',
    use_filename: false,
    unique_filename: true,
    overwrite: false,
    tags: [user.id, contextType, contextId]
  });

  // 8. Store metadata in database
  const upload = await db.fileUpload.create({
    data: {
      ownerId: user.id,
      contextType,
      contextId,
      cloudinaryId: result.public_id,
      cloudinaryUrl: result.secure_url,
      mimeType: mimeType,
      fileSize: buffer.length
    }
  });

  return NextResponse.json({ url: result.secure_url });
}
```

### Access Control for Downloads
```typescript
// Prevent direct Cloudinary access - proxy through our API
export async function GET(req: NextRequest) {
  const user = await getSession(req);
  const { searchParams } = new URL(req.url);
  const uploadId = searchParams.get('id');

  const upload = await db.fileUpload.findUnique({
    where: { id: uploadId },
    include: { gift: true }
  });

  if (!upload) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }

  // Authorization: owner, admin, or gift recipient
  const isOwner = upload.ownerId === user?.id;
  const isAdmin = user?.role === 'ADMIN';
  const isRecipient = upload.gift?.recipientId === user?.id;

  if (!isOwner && !isAdmin && !isRecipient) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  // Redirect to Cloudinary with auth token
  return NextResponse.redirect(upload.cloudinaryUrl);
}
```

### Security Headers for Upload Responses
```typescript
// Prevent MIME sniffing
res.headers.set('Content-Type', 'application/json; charset=utf-8');
res.headers.set('X-Content-Type-Options', 'nosniff');

// Prevent clickjacking
res.headers.set('X-Frame-Options', 'DENY');

// Disable caching for auth-required uploads
res.headers.set('Cache-Control', 'no-store, no-cache, must-revalidate');
```

---

## Testing Requirements

### Unit Tests
- [ ] Webhook signature verification with valid/invalid signatures
- [ ] Timestamp validation (within/outside window)
- [ ] Nonce duplicate detection
- [ ] MIME type validation
- [ ] Image dimension validation
- [ ] Role permission checks

### Integration Tests
- [ ] Full webhook flow: receive → verify → process → store nonce
- [ ] Upload flow: authorize → validate → sanitize → store
- [ ] Cross-user upload rejection
- [ ] Race condition: simultaneous claims

### Security Tests
- [ ] Webhook replay detection
- [ ] Token brute-force (rate limiting)
- [ ] EXIF/metadata stripping verification
- [ ] Privilege escalation attempts
- [ ] SQL injection attempts in search parameters

---

## Deployment Checklist
- [ ] Create role and permission tables
- [ ] Create consumed_webhook_nonces table
- [ ] Deploy webhook verification logic
- [ ] Deploy file_uploads table and authorization logic
- [ ] Configure Cloudinary CORS policy (deny direct access)
- [ ] Set up webhook nonce cleanup job (daily)
- [ ] Update environment variables for all secrets
- [ ] Run smoke tests on all critical flows
- [ ] Enable audit logging for all security events
