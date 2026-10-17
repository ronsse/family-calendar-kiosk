import json, pathlib, urllib.parse, urllib.request
cred = json.loads(pathlib.Path("stacks/homeassistant/config/.storage/application_credentials").read_text())
item = next(c for c in cred["data"]["items"] if c.get("domain") == "google")
entries = json.loads(pathlib.Path("stacks/homeassistant/config/.storage/core.config_entries").read_text())
entry = next(e for e in entries["data"]["entries"] if e.get("domain") == "google")
body = urllib.parse.urlencode({"client_id": item["client_id"], "client_secret": item["client_secret"],
    "refresh_token": entry["data"]["token"]["refresh_token"], "grant_type": "refresh_token"}).encode()
req = urllib.request.Request("https://oauth2.googleapis.com/token", data=body,
    headers={"Content-Type": "application/x-www-form-urlencoded"})
try:
    with urllib.request.urlopen(req, timeout=30) as r:
        print("ALIVE - scope:", json.load(r).get("scope"))
except urllib.error.HTTPError as e:
    print("HTTP", e.code, e.read().decode(errors="replace")[:300])
