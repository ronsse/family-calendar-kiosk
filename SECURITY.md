# Security

Please report a vulnerability privately through this repository's GitHub security advisories
("Report a vulnerability" on the Security tab), not in a public issue, and include the version or
commit, what an attacker can do, and the steps to reproduce it. This app runs on a home network
and is touched by children, so the reports that matter most are any way to reach a PIN-gated or
destructive action from the wall without the PIN, any way a secret (a calendar's secret iCal
address, a Home Assistant token, an image-provider key) can leak into a log, response or
prompt, and any path that could send household data or a photograph to a third party. Expect an
acknowledgement within a week; there is no bug bounty.
