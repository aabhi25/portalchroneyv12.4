/*
 * ============================================================
 * AI Chroney — India Relay Server
 * ============================================================
 *
 * PURPOSE
 *   Forwards CRM sync requests from AI Chroney (US server) to
 *   Caprion LOS or any other CRM that only accepts requests
 *   from Indian IP addresses.
 *
 * DEPLOY INSTRUCTIONS (AWS Mumbai / any India server)
 * ----------------------------------------------------------
 * 1. Launch a t3.micro EC2 in ap-south-1 (Mumbai)
 *    - OS: Ubuntu 22.04 LTS
 *    - Security group: allow inbound TCP port 3000 from your
 *      AI Chroney server IP (or 0.0.0.0/0 if using RELAY_SECRET)
 *
 * 2. Install Node.js on the server:
 *      curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
 *      sudo apt install -y nodejs
 *
 * 3. Copy this file to the server:
 *      scp relay-server.js ubuntu@<ec2-ip>:~/relay-server.js
 *
 * 4. Install the only dependency (express):
 *      npm init -y && npm install express
 *    NOTE: This script requires Node.js 18+ (uses built-in fetch and FormData).
 *    The nodesource install in step 2 installs Node 20, which satisfies this.
 *    Do NOT install node-fetch or form-data packages — they are not used here.
 *
 * 5. Set environment variables and start:
 *      RELAY_SECRET=your-strong-random-secret node relay-server.js
 *
 * 6. (Optional) Keep it running with PM2:
 *      npm install -g pm2
 *      RELAY_SECRET=your-strong-random-secret pm2 start relay-server.js
 *      pm2 save && pm2 startup
 *
 * 7. Set the Relay URL in AI Chroney:
 *      CRM → Connection Settings → Relay URL
 *      Value: http://<ec2-public-ip>:3000
 *
 * ENVIRONMENT VARIABLES
 *   RELAY_SECRET  — Required. A shared secret set on THIS relay server.
 *                   Every request from AI Chroney must carry the header:
 *                     Authorization: Bearer <RELAY_SECRET>
 *
 *   CUSTOM_CRM_RELAY_SECRET — Set this SAME value in your main AI Chroney
 *                   app environment (Replit Secrets). AI Chroney automatically
 *                   reads it and sends it as the Authorization header when
 *                   calling the relay. The two values must match exactly.
 *
 *                   To set it in Replit: Secrets → Add secret:
 *                     Key:   CUSTOM_CRM_RELAY_SECRET
 *                     Value: (same random string as your relay's RELAY_SECRET)
 *
 *   PORT          — Default 3000. The port to listen on.
 *
 * SECURITY NOTES
 *   - Always set RELAY_SECRET to a long random string (32+ chars).
 *   - This relay only forwards POST requests to non-localhost URLs.
 *   - Consider running behind nginx with HTTPS for production.
 * ============================================================
 */

const express = require('express');
const app = express();

app.use(express.json({ limit: '10mb' }));

const RELAY_SECRET = process.env.RELAY_SECRET || '';
const PORT = parseInt(process.env.PORT || '3000', 10);

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', relay: 'AI Chroney India Relay', time: new Date().toISOString() });
});

app.post('/relay', async (req, res) => {
  try {
    // Authenticate request if RELAY_SECRET is configured
    if (RELAY_SECRET) {
      const authHeader = req.headers['authorization'] || '';
      const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
      if (token !== RELAY_SECRET) {
        console.warn(`[Relay] Unauthorized request from ${req.ip}`);
        return res.status(401).json({ error: 'Unauthorized' });
      }
    }

    const { targetUrl, method, contentType, headers: extraHeaders, body, fields, fileUrl, fileField, fileName, fileMimeType } = req.body;

    // Validate required fields
    if (!targetUrl || typeof targetUrl !== 'string') {
      return res.status(400).json({ error: 'Missing targetUrl' });
    }
    if (!body && !fields) {
      return res.status(400).json({ error: 'Missing body or fields' });
    }

    // Block private/local addresses for security
    const parsed = new URL(targetUrl);
    const hostname = parsed.hostname.toLowerCase();
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.startsWith('10.') ||
      hostname.startsWith('192.168.') ||
      /^172\.(1[6-9]|2\d|3[01])\./.test(hostname)
    ) {
      console.warn(`[Relay] Blocked request to private address: ${targetUrl}`);
      return res.status(400).json({ error: 'Private/internal addresses not allowed' });
    }

    console.log(`[Relay] Forwarding ${method || 'POST'} → ${targetUrl} (${contentType})`);

    // Reconstruct the upstream request body matching the original content type
    let upstreamBody;
    const upstreamHeaders = { ...(extraHeaders || {}) };

    if (contentType === 'form-data-with-file' && fields && typeof fields === 'object') {
      // Rebuild multipart/form-data with a binary file attachment.
      // The relay downloads the file from fileUrl, appends it alongside the
      // text fields, and forwards the complete multipart body to Caprion.
      const formData = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        formData.append(k, String(v));
      }
      if (fileUrl) {
        console.log(`[Relay] Downloading file from ${fileUrl}`);
        const fileResp = await fetch(fileUrl);
        if (!fileResp.ok) {
          console.error(`[Relay] Failed to fetch file: ${fileResp.status}`);
          return res.status(502).json({ error: `Failed to fetch file from fileUrl: HTTP ${fileResp.status}` });
        }
        const fileBlob = await fileResp.blob();
        const name = fileName || 'document.jpg';
        formData.append(fileField || 'Files[]', fileBlob, name);
        console.log(`[Relay] Attached file: ${name} (${fileBlob.size} bytes, type=${fileBlob.type || fileMimeType || 'unknown'})`);
      }
      upstreamBody = formData;
      // Do NOT set Content-Type — fetch sets it with the correct boundary automatically
    } else if (contentType === 'form-data' && fields && typeof fields === 'object') {
      // Rebuild multipart/form-data — same as direct path using FormData
      // This preserves the exact wire format Caprion expects
      const formData = new FormData();
      for (const [k, v] of Object.entries(fields)) {
        formData.append(k, String(v));
      }
      upstreamBody = formData;
      // Do NOT set Content-Type — fetch sets it with the correct boundary automatically
    } else if (contentType === 'application/json') {
      upstreamBody = body;
      upstreamHeaders['Content-Type'] = 'application/json';
    } else {
      // Fallback: forward body string as-is with provided content type
      upstreamBody = body;
      if (contentType) upstreamHeaders['Content-Type'] = contentType;
    }

    const upstream = await fetch(targetUrl, {
      method: method || 'POST',
      headers: upstreamHeaders,
      body: upstreamBody,
    });

    const responseText = await upstream.text();
    // Caprion's UploadDocument echoes 'document_password' in the response body. Mask it before
    // logging so plaintext bank-statement passwords never reach relay logs. The response body
    // forwarded to AI Chroney below is unmodified — only the local log line is sanitized.
    const safeResponseText = responseText.replace(
      /"document_password"\s*:\s*"[^"]*"/g,
      '"document_password":"***"'
    );
    console.log(`[Relay] Upstream responded ${upstream.status} — ${safeResponseText.slice(0, 200)}`);

    // Mirror upstream status and body back to AI Chroney
    res.status(upstream.status);
    upstream.headers.forEach((value, key) => {
      if (['content-type', 'content-length'].includes(key.toLowerCase())) {
        res.setHeader(key, value);
      }
    });
    res.send(responseText);
  } catch (err) {
    console.error('[Relay] Error:', err);
    res.status(502).json({ error: 'Relay failed', detail: err.message });
  }
});

// Enforce RELAY_SECRET on startup. Set ALLOW_INSECURE_RELAY=true only for local testing.
if (!RELAY_SECRET) {
  if (process.env.ALLOW_INSECURE_RELAY === 'true') {
    console.warn('[Relay] WARNING: RELAY_SECRET is not set and ALLOW_INSECURE_RELAY=true — relay is open to anyone. DO NOT use this in production!');
  } else {
    console.error('[Relay] FATAL: RELAY_SECRET environment variable is required. Set it to a strong random string (32+ chars).');
    console.error('[Relay] To bypass for local testing only: ALLOW_INSECURE_RELAY=true RELAY_SECRET="" node relay-server.js');
    process.exit(1);
  }
}

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Relay] AI Chroney India Relay running on port ${PORT}`);
  if (RELAY_SECRET) {
    console.log('[Relay] RELAY_SECRET is configured — requests require Authorization: Bearer header.');
  }
});
