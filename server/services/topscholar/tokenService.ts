import crypto from 'crypto';

/**
 * TopScholar launch-token handshake.
 *
 * The host app (the client's student portal) opens the chatbot with a signed
 * token that seals the student's identity and curriculum scope so none of it can
 * be tampered with in the browser. Two shapes are supported:
 *   1. Scope token (preferred — "Option B"): carries board / medium / grade /
 *      subject + studentId + name. The server resolves the scope to cp_id(s),
 *      so the client never has to handle internal content IDs.
 *   2. Legacy cp_id token: carries cp_id + studentId + name directly.
 *
 * Token format (compact, dependency-free HMAC):
 *   base64url(JSON payload) + "." + base64url(HMAC-SHA256(payload, secret))
 */

export interface LaunchTokenPayload {
  cpId?: string | null;
  board?: string | null;
  medium?: string | null;
  grade?: string | null;
  subject?: string | null;
  chapter?: string | null;
  studentId?: string | null;
  name?: string | null;
  // TopScholar doubt-sync: the doubt this AI session is bound to on the client
  // platform. Present only in the newer token shape; older tokens omit it.
  doubtId?: string | null;
  // Pass-through identifiers from the client portal, stored for reference.
  studentPlanMappingId?: string | null;
  planId?: string | null;
  iat?: number; // issued-at (seconds)
  exp?: number; // optional expiry (seconds)
}

export interface DerivedHandoff {
  cpId: string | null;
  board: string | null;
  medium: string | null;
  grade: string | null;
  subject: string | null;
  chapter: string | null;
  studentId: string | null;
  studentName: string | null;
  // TopScholar doubt-sync fields (null when the token predates them).
  doubtId: string | null;
  studentPlanMappingId: string | null;
  planId: string | null;
  source: 'signed' | 'uat_plain';
}

function b64urlEncode(buf: Buffer): string {
  return buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(str: string): Buffer {
  const pad = str.length % 4 === 0 ? '' : '='.repeat(4 - (str.length % 4));
  return Buffer.from(str.replace(/-/g, '+').replace(/_/g, '/') + pad, 'base64');
}

export function signLaunchToken(secret: string, payload: LaunchTokenPayload): string {
  const body = { iat: Math.floor(Date.now() / 1000), ...payload };
  const json = Buffer.from(JSON.stringify(body), 'utf8');
  const encoded = b64urlEncode(json);
  const sig = crypto.createHmac('sha256', secret).update(encoded).digest();
  return `${encoded}.${b64urlEncode(sig)}`;
}

export function verifyLaunchToken(secret: string, token: string): LaunchTokenPayload | null {
  try {
    const [encoded, sig] = token.split('.');
    if (!encoded || !sig) return null;

    const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
    const got = b64urlDecode(sig);
    if (expected.length !== got.length || !crypto.timingSafeEqual(expected, got)) {
      return null;
    }

    const payload = JSON.parse(b64urlDecode(encoded).toString('utf8')) as LaunchTokenPayload;
    if (!payload || typeof payload !== 'object') return null;
    if (payload.exp && Math.floor(Date.now() / 1000) > payload.exp) return null;
    // Accept either a legacy cp_id token OR a scope token (board+medium+grade+
    // subject). The caller enforces which fields are mandatory for its mode.
    const hasCpId = typeof payload.cpId === 'string' && !!payload.cpId;
    const hasScope = !!(payload.board && payload.medium && payload.grade && payload.subject);
    if (!hasCpId && !hasScope) return null;
    return payload;
  } catch {
    return null;
  }
}

// ---- Detailed verification (Debug Dashboard) --------------------------------
// Non-throwing, step-by-step token verification that reports WHY a token fails
// instead of returning null. Never used on the hot chat path — this powers the
// admin Token Inspector and the debug logger.

export interface TokenCheck {
  ok: boolean;
  label: string;
  detail: string;
}

export interface DetailedTokenResult {
  valid: boolean;
  reason: string | null;          // first failing check, human-readable
  payload: LaunchTokenPayload | null; // decoded payload even if invalid (when decodable)
  checks: TokenCheck[];
}

const OBJECT_ID_RE = /^[0-9a-f]{24}$/i;

export function verifyLaunchTokenDetailed(secret: string | null, token: string): DetailedTokenResult {
  const checks: TokenCheck[] = [];
  let payload: LaunchTokenPayload | null = null;
  const fail = (reason: string): DetailedTokenResult => ({ valid: false, reason, payload, checks });

  // 1. Format — EXACTLY mirrors verifyLaunchToken(): split on '.', take the first
  // two parts, no trimming. Any divergence here would make diagnostics disagree
  // with production acceptance.
  const [encoded, sig, ...extra] = String(token || '').split('.');
  if (!encoded || !sig) {
    checks.push({ ok: false, label: 'Format', detail: 'Token must be two base64url parts separated by a dot (payload.signature).' });
    return fail('Malformed token: expected "payload.signature" format.');
  }
  checks.push({
    ok: true,
    label: 'Format',
    detail: extra.length > 0
      ? `payload.signature structure found (note: ${extra.length} extra dot-separated part(s) after the signature are ignored — the signature check will fail unless the second part is the full signature).`
      : /\s/.test(token)
        ? 'payload.signature structure found (warning: token contains whitespace — production does NOT trim, so leading/trailing whitespace corrupts the payload or signature part).'
        : 'Two-part payload.signature structure found.',
  });

  // 2. Payload decodes to JSON
  try {
    payload = JSON.parse(b64urlDecode(encoded).toString('utf8')) as LaunchTokenPayload;
    if (!payload || typeof payload !== 'object') throw new Error('not an object');
    checks.push({ ok: true, label: 'Payload', detail: 'Payload decodes to a JSON object.' });
  } catch {
    payload = null;
    checks.push({ ok: false, label: 'Payload', detail: 'Payload part is not valid base64url-encoded JSON.' });
    return fail('Payload is not decodable JSON.');
  }

  // 3. Signature
  if (!secret) {
    checks.push({ ok: false, label: 'Signature', detail: 'No launch-token secret is configured on this account — cannot verify.' });
    return fail('Launch-token secret is not configured.');
  }
  const expected = crypto.createHmac('sha256', secret).update(encoded).digest();
  let sigOk = false;
  try {
    const got = b64urlDecode(sig);
    sigOk = expected.length === got.length && crypto.timingSafeEqual(expected, got);
  } catch {
    sigOk = false;
  }
  if (!sigOk) {
    checks.push({ ok: false, label: 'Signature', detail: 'HMAC-SHA256 signature does not match. Common causes: different secret on client vs server, trailing whitespace/newline in the secret, or signing the raw JSON instead of the base64url-encoded payload.' });
    return fail('Signature mismatch — token was signed with a different secret.');
  }
  checks.push({ ok: true, label: 'Signature', detail: 'HMAC-SHA256 signature verifies against the configured secret.' });

  // 4. Expiry
  const nowSec = Math.floor(Date.now() / 1000);
  if (payload.exp) {
    if (nowSec > payload.exp) {
      const mins = Math.round((nowSec - payload.exp) / 60);
      checks.push({ ok: false, label: 'Expiry', detail: `Token expired ${mins} minute(s) ago (exp=${new Date(payload.exp * 1000).toISOString()}). The client portal must mint a fresh token on every page load, not reuse one minted at server boot.` });
      return fail(`Token expired ${mins} minute(s) ago.`);
    }
    const minsLeft = Math.round((payload.exp - nowSec) / 60);
    checks.push({ ok: true, label: 'Expiry', detail: `Valid for another ${minsLeft} minute(s) (exp=${new Date(payload.exp * 1000).toISOString()}).` });
  } else {
    checks.push({ ok: true, label: 'Expiry', detail: 'No exp field — token never expires (consider adding one, 60 min recommended).' });
  }

  // 5. Scope / cp_id requirement
  const hasCpId = typeof payload.cpId === 'string' && !!payload.cpId;
  const hasScope = !!(payload.board && payload.medium && payload.grade && payload.subject);
  if (!hasCpId && !hasScope) {
    const missing = (['board', 'medium', 'grade', 'subject'] as const).filter((k) => !payload![k]);
    checks.push({ ok: false, label: 'Scope fields', detail: `Missing: ${missing.join(', ')}. A token must carry either cpId, or ALL of board+medium+grade+subject.` });
    return fail(`Missing scope field(s): ${missing.join(', ')}.`);
  }
  checks.push({ ok: true, label: 'Scope fields', detail: hasScope ? `Full scope present: ${payload.board} / ${payload.medium} / ${payload.grade} / ${payload.subject}.` : `Legacy cpId token (cpId=${payload.cpId}).` });

  // 6. Human-readable scope values (flag Mongo ObjectIds)
  const idLike = (['board', 'medium', 'grade', 'subject'] as const).filter(
    (k) => typeof payload![k] === 'string' && OBJECT_ID_RE.test(String(payload![k])),
  );
  if (idLike.length > 0) {
    checks.push({ ok: false, label: 'Readable scope', detail: `These fields look like Mongo ObjectIds, not names: ${idLike.join(', ')}. The server matches by NAME (e.g. "Maharashtra Board", "Geography") — ObjectIds will resolve 0 cp_ids.` });
  } else if (hasScope) {
    checks.push({ ok: true, label: 'Readable scope', detail: 'All scope fields are human-readable names.' });
  }

  // 7. Student identity
  const hasStudent = !!(payload.studentId && payload.name);
  checks.push({
    ok: hasStudent,
    label: 'Student identity',
    detail: hasStudent
      ? `studentId=${payload.studentId}, name=${payload.name}.`
      : `Missing ${!payload.studentId ? 'studentId' : ''}${!payload.studentId && !payload.name ? ' and ' : ''}${!payload.name ? 'name' : ''} — required in secure mode.`,
  });

  // 8. Doubt-sync fields (informational — sync silently skips without them)
  const hasDoubt = !!payload.doubtId;
  checks.push({
    ok: hasDoubt,
    label: 'Doubt-sync fields',
    detail: hasDoubt
      ? `doubtId=${payload.doubtId}${payload.planId ? `, planId=${payload.planId}` : ' (planId absent — escalation email will send blank plan_id)'}${payload.studentPlanMappingId ? `, studentPlanMappingId=${payload.studentPlanMappingId}` : ''}.`
      : 'doubtId is ABSENT — conversation sync to the client platform will NOT fire for this session.',
  });

  const hardFail = checks.find((c) => !c.ok && c.label !== 'Doubt-sync fields' && c.label !== 'Student identity' && c.label !== 'Readable scope');
  if (hardFail) return fail(hardFail.detail);
  return { valid: true, reason: null, payload, checks };
}

/**
 * Derive the curriculum handoff (cp_id + student identity) from request inputs.
 * Prefers a signed token; falls back to a plain cp_id param ONLY when the account
 * has UAT plain-cp_id mode enabled (used until the client's signing backend is ready).
 */
export function deriveHandoff(
  cfg: { tokenSecret: string | null; uatPlainCpId: boolean },
  input: { token?: string | null; cpId?: string | null },
): DerivedHandoff | null {
  if (input.token && cfg.tokenSecret) {
    const payload = verifyLaunchToken(cfg.tokenSecret, input.token);
    if (payload) {
      return {
        cpId: payload.cpId ?? null,
        board: payload.board ?? null,
        medium: payload.medium ?? null,
        grade: payload.grade ?? null,
        subject: payload.subject ?? null,
        chapter: payload.chapter ?? null,
        studentId: payload.studentId ?? null,
        studentName: payload.name ?? null,
        doubtId: payload.doubtId ?? null,
        studentPlanMappingId: payload.studentPlanMappingId ?? null,
        planId: payload.planId ?? null,
        source: 'signed',
      };
    }
    // Invalid signature => do not silently fall back to plain cp_id.
    return null;
  }

  if (cfg.uatPlainCpId && input.cpId) {
    return {
      cpId: input.cpId,
      board: null,
      medium: null,
      grade: null,
      subject: null,
      chapter: null,
      studentId: null,
      studentName: null,
      doubtId: null,
      studentPlanMappingId: null,
      planId: null,
      source: 'uat_plain',
    };
  }

  return null;
}
