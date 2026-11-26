#!/usr/bin/env bash
# Security-gate drill (SEC-EGR-2): prove containers holding data can't reach the
# internet except through the allowlist proxy. Exit 1 on any failure.
set -uo pipefail
fail=0
pass() { printf "  PASS  %s\n" "$1"; }
bad()  { printf "  FAIL  %s\n" "$1"; fail=1; }

# 0. Structural: the data network must be marked internal (no gateway to the
#    internet), and data services must be attached to nothing else.
if [ "$(docker network inspect brain_internal --format '{{.Internal}}')" = "true" ]; then
  pass "network brain_internal has no route to the internet"
else
  bad "network brain_internal is not internal"
fi
for svc in gateway forgejo db; do
  nets=$(docker inspect "brain-$svc-1" --format '{{range $k, $v := .NetworkSettings.Networks}}{{$k}} {{end}}')
  [ "$(echo $nets)" = "brain_internal" ] && pass "$svc is only on brain_internal" || bad "$svc is on: $nets"
done

for svc in gateway forgejo db; do
  c="brain-$svc-1"
  # 1. Direct connection must fail: the internal network has no route out.
  if docker exec "$c" sh -c 'wget -q -T 5 -O /dev/null https://example.com' >/dev/null 2>&1; then
    bad "$svc reached example.com directly"
  else
    pass "$svc cannot reach the internet directly"
  fi
done

# 2. Through the proxy, a host NOT on the allowlist is refused by policy (HTTP 403).
code=$(docker exec brain-gateway-1 sh -c \
  'printf "CONNECT example.com:443 HTTP/1.1\r\nHost: example.com:443\r\n\r\n" | nc -w 5 egress-proxy 3128 | head -1' 2>/dev/null)
case "$code" in *" 403 "*) pass "proxy refuses non-allowlisted host ($code)";; *) bad "proxy did not refuse example.com: '$code'";; esac

# 3. An allowlisted host is permitted by policy (anything but 403; 200 when the
#    machine has internet access, 503 in a sandbox without it).
code=$(docker exec brain-gateway-1 sh -c \
  'printf "CONNECT accounts.google.com:443 HTTP/1.1\r\nHost: accounts.google.com:443\r\n\r\n" | nc -w 10 egress-proxy 3128 | head -1' 2>/dev/null)
case "$code" in *" 403 "*|"") bad "proxy refused allowlisted host: '$code'";; *) pass "proxy permits allowlisted host ($code)";; esac

exit $fail
