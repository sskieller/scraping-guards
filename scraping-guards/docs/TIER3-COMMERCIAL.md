# Tier 3 — Managed & Self-Hosted Bot Defense: What to Install, and What It Costs

Tier 1 guards (26–41) are implemented in this repo. Tier 2 guards (42–46) are
**stubs**, because TLS/TCP/HTTP2-level detection needs infrastructure below the
application. This document covers the real options for both: what to install,
how, and what it costs.

> **Pricing caveat — read this before budgeting.** Figures below are *indicative
> list prices* collected from public pricing pages and are **stale the moment
> they are written**. Vendors change pricing, most bot-defense products are
> quote-only, and real cost depends on request volume, traffic mix, and
> negotiation. Anything marked **"quote"** has no public price at all. Treat this
> as a shortlist for procurement, **not** as a quote — confirm every number with
> the vendor. Where a figure is a widely-reported range rather than a published
> price, it is marked *(reported)*.

---

## 1. Decision guide — what do you actually need?

| Situation | Recommendation |
|---|---|
| Hobby / internal app, want the scraping to just stop being trivial | Self-hosted: Anubis (PoW) + CrowdSec + Cloudflare Free. **$0** |
| Commercial site, moderate abuse, already on Cloudflare | Cloudflare Pro/Business + Turnstile. **$20–200/mo** |
| Already on AWS, want native integration | AWS WAF + Bot Control. **~$20–50/mo + per-request** |
| Content/pricing being scraped at scale by a determined adversary | DataDome / HUMAN / Kasada. **$1.5k/mo → six figures/yr** |
| Credential stuffing / account takeover is the real threat | Arkose, Castle, or reCAPTCHA Enterprise |
| You only need the *signals* (JA3, ASN, proxy detection), not enforcement | Fingerprint Pro, IPQualityScore, MaxMind, Spur |

**Blunt advice:** the jump from Tier 1+2 self-hosted to a commercial Tier 3
product is large (often $20k+/yr). Exhaust Cloudflare's free/cheap tiers and
self-hosted PoW first — for most projects that is genuinely enough. Buy Tier 3
when scraping is costing you more than the license.

---

## 2. Free / self-hosted — closes most of Tier 2 for $0

Infrastructure cost only. These are what I'd install before spending anything.

### 2.1 JA3/JA4 TLS fingerprinting → replaces stub guard 42

The stub in `lib/netstub.js` fakes this. Real capture needs a TLS-terminating
proxy that exposes the ClientHello.

**HAProxy** (has native JA3/JA4 support in recent versions):
```
# haproxy.cfg
frontend https
    bind *:443 ssl crt /etc/ssl/site.pem
    http-request set-header X-JA4 %[ssl_fc_ja4]
    # Block a known-bad fingerprint outright:
    acl bad_ja4 req.hdr(X-JA4) -m str t13d1516h2_8daaf6152771_b0da82dd1658
    http-request deny if bad_ja4
    default_backend app
```

**nginx** — core nginx cannot do JA3; you need a patched build or a module:
```bash
# Option A: nginx-module-ja3 (Apache-2.0)
git clone https://github.com/fooinha/nginx-ssl-ja3
./configure --add-module=../nginx-ssl-ja3 --with-http_ssl_module
# then: proxy_set_header X-JA3 $http_ssl_ja3_hash;
```

**Envoy** — `tls_inspector` listener filter emits JA3/JA4 to metadata.

**Cost: $0** (self-hosted). Complexity: moderate — you must terminate TLS.

### 2.2 Proof of work at the edge → productionizes guard 27

**Anubis** — a reverse proxy that puts a PoW interstitial in front of your app.
Purpose-built for blocking AI scrapers; MIT licensed.
```yaml
# docker-compose.yml
services:
  anubis:
    image: ghcr.io/techarohq/anubis:latest
    environment:
      BIND: ":8080"
      TARGET: "http://app:3000"
      DIFFICULTY: "4"          # leading zero bits; 4-5 is typical
      POLICY_FNAME: "/policy.yaml"
    ports: ["8080:8080"]
```
**Cost: $0** + a little CPU. This is the single highest-leverage free option
against LLM-training scrapers specifically.

### 2.3 Behavioral IP banning → complements guards 25/40

**CrowdSec** — collaborative IP reputation; the community blocklist is free.
```bash
curl -s https://install.crowdsec.net | sudo sh
sudo apt install crowdsec
sudo cscli collections install crowdsecurity/nginx crowdsecurity/http-cve
sudo apt install crowdsec-firewall-bouncer-iptables
sudo cscli decisions list
```
**Cost:** OSS agent **$0**; hosted console free tier, paid tiers from roughly
**$30–300/mo** *(reported)* for larger fleets and premium blocklists.

### 2.4 WAF → generic request filtering

**Coraza** (Go, OWASP, actively maintained) or **ModSecurity** with the OWASP
Core Rule Set. Caddy/Envoy/nginx integrations exist.
```bash
# Caddy + Coraza
xcaddy build --with github.com/corazawaf/coraza-caddy/v2
```
**Cost: $0.**

### 2.5 OS/TCP fingerprinting → replaces stub guard 44

**p0f** — passive fingerprinting from raw packets. Needs `CAP_NET_RAW` and a
network position where you see the SYN.
```bash
sudo apt install p0f
sudo p0f -i eth0 -o /var/log/p0f.log
```
**Cost: $0.** Caveat: behind a load balancer or CDN you see the LB's stack, not
the client's — this is often unusable in cloud deployments.

### 2.6 IP intelligence (free tiers) → partially replaces stub guard 45

| Product | Free tier | Paid |
|---|---|---|
| **MaxMind GeoLite2** (ASN + Country) | Free with account + license key | GeoIP2 City from **~$24/mo** or one-time DB purchase |
| **Tor exit list** | Free (`check.torproject.org/exit-addresses`) | — |
| **IPQualityScore** | ~5,000 lookups/mo free | from **~$99/mo** *(reported)* |
| **AbuseIPDB** | 1,000 checks/day free | from **~$20/mo** |

```bash
# MaxMind GeoLite2 ASN — free, updated weekly
pip install geoip2 maxminddb
# then look up ASN and block known hosting providers (AS14061 DigitalOcean, etc.)
```

---

## 3. Cheap commercial — the sensible first spend

### 3.1 Cloudflare

The default answer for most teams; you may already be behind it.

| Plan | Price | Bot features |
|---|---|---|
| Free | **$0** | Bot Fight Mode, free WAF rules, unmetered DDoS |
| Pro | **~$20/mo per domain** | Super Bot Fight Mode (definitely/likely-automated rules) |
| Business | **~$200/mo per domain** | Super Bot Fight Mode + custom WAF |
| Enterprise | **quote** *(commonly reported 5-figure+/yr)* | Full **Bot Management** — ML scoring, JA3/JA4, behavioral |

**Turnstile** (CAPTCHA replacement — this is what productionizes guard 26):
**free** for the standard product, including on Free plans; Enterprise tiers quoted.

```html
<!-- Turnstile: free, privacy-preserving, no puzzle for most users -->
<script src="https://challenges.cloudflare.com/turnstile/v0/api.js" async defer></script>
<div class="cf-turnstile" data-sitekey="YOUR_SITE_KEY"></div>
```
```bash
# Server-side verification
curl -X POST https://challenges.cloudflare.com/turnstile/v0/siteverify \
  -d secret=$TURNSTILE_SECRET -d response=$TOKEN
```

> Note: real **Bot Management** (the JA3/behavioral ML product) is Enterprise-only.
> Super Bot Fight Mode on Pro/Business is a meaningfully weaker product — do not
> assume $20/mo buys you Tier 3 detection.

### 3.2 AWS WAF + Bot Control

Native if you're on ALB/CloudFront/API Gateway.

| Component | Indicative price |
|---|---|
| Web ACL | **~$5/month** |
| Each rule | **~$1/month** |
| Requests | **~$0.60 per million** |
| Bot Control (Common) | **~$10/month** + **~$1 per million requests** |
| Bot Control (Targeted — ML, TLS fingerprinting) | additional **~$10/month** + **~$10 per million requests** |

```hcl
resource "aws_wafv2_web_acl" "main" {
  name = "bot-protection"
  scope = "CLOUDFRONT"
  default_action { allow {} }

  rule {
    name     = "AWS-AWSManagedRulesBotControlRuleSet"
    priority = 1
    override_action { none {} }
    statement {
      managed_rule_group_statement {
        vendor_name = "AWS"
        name        = "AWSManagedRulesBotControlRuleSet"
        managed_rule_group_configs {
          aws_managed_rules_bot_control_rule_set {
            inspection_level = "TARGETED"   # COMMON is cheaper
          }
        }
      }
    }
    visibility_config {
      cloudwatch_metrics_enabled = true
      metric_name                = "BotControl"
      sampled_requests_enabled   = true
    }
  }
  visibility_config {
    cloudwatch_metrics_enabled = true
    metric_name                = "main"
    sampled_requests_enabled   = true
  }
}
```
**Watch the per-million charge** — at 100M requests/month, Targeted Bot Control
alone is roughly **$1,000/month** in request fees. Model your volume first.

### 3.3 CAPTCHA / challenge services → productionize guard 26

| Product | Free tier | Paid |
|---|---|---|
| **Cloudflare Turnstile** | Free | Enterprise quote |
| **hCaptcha** | Free (publisher tier) | Pro **~$99/mo**; Enterprise quote |
| **reCAPTCHA (Google Cloud)** | ~10,000 assessments/mo free | roughly **$1–8 per 1,000 assessments** depending on tier/features; Enterprise quote |
| **Friendly Captcha** | trial | from **~€39/mo** *(reported)* |

Recommendation: **Turnstile** unless you need reCAPTCHA Enterprise's
account-takeover scoring specifically.

### 3.4 Signal-only providers (you enforce)

Useful if you want to keep your own logic — closest to what this repo does.

| Product | Indicative price |
|---|---|
| **Fingerprint** (Pro / Bot Detection) | free trial; paid from **~$99/mo** for ~20k identifications; Business tiers ~$1k/mo; Enterprise quote |
| **Castle** | free dev tier; paid from **~$99/mo** *(reported)* |
| **Spur** (proxy/VPN detection) | quote *(reported ~$1k+/mo)* |
| **IPQualityScore** | from **~$99/mo** |

```js
// Fingerprint Pro — returns a stable visitorId plus bot/VPN/incognito signals
import FingerprintJS from '@fingerprintjs/fingerprintjs-pro'
const fp = await FingerprintJS.load({ apiKey: 'PUBLIC_KEY' })
const { visitorId, bot } = await fp.get({ extendedResult: true })
```

---

## 4. Enterprise bot management — the real Tier 3

All of these are **quote-only**. The ranges below are *reported* deal sizes, not
published prices, and vary enormously with traffic volume.

| Vendor | Reported entry point | Notes |
|---|---|---|
| **DataDome** | from **~$1,590/mo** *(published starting price, annual)* | Most transparent pricing in this class; ~2ms decisions; good API/mobile coverage |
| **Cloudflare Bot Management** | Enterprise quote *(5-figure+/yr reported)* | Best value if already Cloudflare Enterprise |
| **HUMAN Security** (ex-PerimeterX) | quote *(~$30k+/yr reported)* | Strong on ad fraud + account takeover |
| **Imperva Advanced Bot Protection** | quote *(~$20k+/yr reported)* | Ex-Distil Networks; mature |
| **Akamai Bot Manager** | quote *(~$30k–100k+/yr reported)* | Usually bundled with Akamai CDN |
| **Kasada** | quote *(~$50k+/yr reported)* | Client-side PoW + obfuscation; strong anti-reverse-engineering |
| **Arkose Labs** | quote *(~$40k+/yr reported)* | Interactive challenges; ATO/fraud focus |
| **F5 Distributed Cloud Bot Defense** | quote | Ex-Shape Security; heavy enterprise |

### What you actually get for that money

The thing you cannot self-host is **cross-customer intelligence**. These vendors
see a given scraper's fingerprint across thousands of properties, so they block
it on your site the first time it appears. Everything else — PoW, JA3, behavior,
rate limiting — you can build (and this repo largely does).

### Evaluation checklist

1. **Insist on a PoC against your real traffic.** False-positive rate on
   legitimate users is the number that matters, not catch rate.
2. **Model the bill at peak,** not average — most are request-metered.
3. **Check mobile/API coverage** if you have native apps; several are web-only.
4. **Ask about the SDK's failure mode.** If their JS fails to load, does your
   site block everyone?
5. **Confirm accessibility.** Challenge products must not lock out screen-reader
   or keyboard-only users.
6. **Get the exit path in writing** — how do you take your rules with you?

---

## 5. Mapping this repo's guards to what you'd buy

| Guards here | Free/self-hosted replacement | Commercial replacement |
|---|---|---|
| 26 CAPTCHA interstitial | Anubis | Turnstile (free) / hCaptcha / reCAPTCHA |
| 27 Proof-of-work | Anubis | Kasada |
| 28–31 obfuscation, DOM randomization | (build yourself) | Kasada, DataDome script obfuscation |
| 32–34 headers, referer, session/CSRF | Coraza/ModSecurity + CRS | Any WAF |
| 35–36 automation & behavior | (build yourself) | Fingerprint, HUMAN, DataDome |
| 40 rate limiting | nginx `limit_req`, CrowdSec | Cloudflare Rate Limiting |
| **42 TLS/JA3** *(stub)* | **HAProxy / Envoy / nginx-ssl-ja3** | Cloudflare Ent, DataDome, Akamai |
| **43 HTTP/2 fingerprint** *(stub)* | Envoy (partial) | Akamai, Cloudflare Ent |
| **44 OS/TCP fingerprint** *(stub)* | p0f | Akamai, F5 |
| **45 IP reputation** *(stub)* | MaxMind GeoLite2 + Tor list + CrowdSec | IPQualityScore, Spur, all Tier-3 vendors |
| **46 Connection limits** *(partial)* | nginx `limit_conn` | Any CDN |

---

## 6. Legal and ethical note

Anti-scraping controls are not purely technical. Before investing:

- **robots.txt and ToS** define what is *permitted*; these controls define what
  is *possible*. Keep both, and keep them consistent.
- **Do not block accessibility tooling.** Screen readers, text browsers, and
  keyboard navigation must keep working — several guards in this repo
  (anti-copy, canvas text, glyph fonts) actively harm accessibility and should
  be used narrowly, if at all, on real sites.
- **Allow legitimate crawlers** you actually want (search engines, previews,
  archive.org) via verified reverse-DNS or published IP ranges, not UA strings.
- **Scraping law varies by jurisdiction** and is unsettled; blocking is your
  right, but consider a documented API or licensed data feed as the cheaper
  answer to persistent scrapers.

---

*Compiled 2026-08. Verify all pricing directly with vendors before making
purchasing decisions — none of the figures here are quotes.*
