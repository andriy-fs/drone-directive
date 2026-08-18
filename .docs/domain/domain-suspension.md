# Domain suspension (`serverHold`)

On **2026-08-18**, ~23 hours after registration, `drone-directive.space` went
`NXDOMAIN`. The registry (**Radix**, operator of `.space`) had placed the domain
on **`serverHold`** — a registry-level status that removes the name from the TLD
zone. No reason was ever given.

Nothing was wrong on our side: the Cloudflare zone, the DNS records and both
deploys stayed intact the whole time. Only the delegation was gone, so a fix
needs no redeploy.

Both halves were down together, since the relay lives on the same domain
(`relay.drone-directive.space`) and `workers.dev` is disabled by the
`[[routes]]` entries in `client/wrangler.toml` and `server/wrangler.toml`.

## What actually resolved it

Not the registry's own form (<https://abuse.radix.website/unsuspension>) — that
request was filed and never answered. It was resolved in **~2 hours** by
Namecheap's **Legal & Abuse** team, reached through LiveChat support.

## If it happens again

Write **immediately** to:

```
legalandabuse@namecheap.com
```

That address was given by Namecheap support as the direct channel for
suspension reasons and details — it skips first-line support, which will
otherwise deflect with "only the registry can lift this". File the Radix form
too, but do not wait on it.

Ask for: the abuse category the registry flagged, escalation to Radix, and
confirmation of registrant identity (WhoisGuard hides it — public WHOIS shows
the `Withheld for Privacy ehf` proxy).

## Diagnosing

```sh
# Registry truth: look for "server hold" in status
curl -s -H 'Accept: application/rdap+json' https://rdap.org/domain/drone-directive.space | jq '.status, .events'

# Resolution (Status 3 = NXDOMAIN from the .space zone itself)
curl -s 'https://dns.google/resolve?name=drone-directive.space&type=A'
```

`serverHold` is set by the registry and only the registry can lift it;
`clientHold` would be the registrar's and often means an unverified registrant
email. Registrar WHOIS may lag by hours and show neither — the registry RDAP
record is authoritative.
