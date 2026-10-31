# Agency web addresses (custom domains)

Agencies can give their portal and chat widget their own address, such as `app.agency.com`.
The app side is done: it recognises the address, shows the agency's brand, and only lets that
agency's people log in there. One thing has to be set up once, in front of the app on the live
server: a secure (HTTPS) certificate for each agency address. Pick one of the two options below.

## How an agency address is connected

1. Super admin › Agencies › (agency) › Brand › **Own web address**: enter `app.agency.com`.
   (Or the agency does it on its Brand page, if its plan includes "Set its own web address".)
2. The agency adds a DNS record where its domain is managed:
   `CNAME  app  →  portal.aichroney.com`
3. Press **Check now**. When the record is found, the address shows **Connected**.
4. The certificate service (below) issues the certificate on the first visit.

The CNAME target is `portal.aichroney.com` unless the server sets `AGENCY_DOMAIN_TARGET`.
Our own domains can never be claimed (`PLATFORM_DOMAINS`, default `aichroney.com,chroney.ai`).

## Option A (recommended if aichroney.com is on Cloudflare): Cloudflare custom hostnames

Cloudflare for SaaS issues and renews a certificate per agency address and forwards requests to
our server with the agency address as the host name, which is what the app needs.

1. In Cloudflare (aichroney.com zone) › SSL/TLS › Custom Hostnames: set the fallback origin to
   `portal.aichroney.com`.
2. For each agency, add a custom hostname `app.agency.com` (or automate it later via the API).
3. The agency's CNAME stays `app → portal.aichroney.com`.

## Option B: Caddy on the server, with automatic certificates

Caddy can issue a certificate the first time an address is visited, after asking the app whether
the address belongs to an agency (`/api/domains/tls-check?domain=…` answers 200 or 404), so
nobody can make us issue certificates for random names.

```
{
  on_demand_tls {
    ask http://127.0.0.1:5000/api/domains/tls-check
  }
}

https:// {
  tls {
    on_demand
  }
  reverse_proxy 127.0.0.1:5000
}
```

Replace `5000` with the app's port. Keep the existing portal.aichroney.com setup as it is; this
block only catches other host names. Ports 80 and 443 must reach Caddy.

## Checking it works

- `https://app.agency.com` shows the agency's name and logo on the login page and browser tab.
- Only that agency's logins and its clients can log in there.
- In a client's portal, the widget install code starts with `https://app.agency.com/`.
