# Documentation

Start with [setup.md](setup.md) to run the wall, then [architecture.md](architecture.md) to see
how it works.

## Using it

- [setup.md](setup.md): from a fresh clone to the example household in a browser, then to your
  own household, a server and a Raspberry Pi.
- [architecture.md](architecture.md): what runs where, what holds state, and why each part is
  built the way it is.
- [household-config.md](household-config.md): every key in `db/household.json`, its default,
  and how to apply it.
- [scenes.md](scenes.md): the wall's pictures, which models draw them, what they cost, and the
  guardrails around them.
- [runbook.md](runbook.md): bringing the wall up and repairing it, written to be followed at
  6:05 AM.
- [extension-points.md](extension-points.md): the ten places built to be extended, each with
  its interface, file, test and a worked example.
- [api.md](api.md): the HTTP contract between the wall, the grown-up screens and the server.
- [BACKLOG.md](BACKLOG.md): open work, one line each.

## How it was built

These are the design history. They are kept as they were written, so some describe plans that
later changed; the documents above describe the code as it is.

- [PRD.md](PRD.md): the problem, the invariants and what is out of scope.
- [ROADMAP.md](ROADMAP.md): the milestones, what is done and what is next.
- [build-plan.md](build-plan.md): how the first build was split across parallel agents.
- [work-packages.md](work-packages.md): the same split for the work after the first build.
- [phone-admin-plan.md](phone-admin-plan.md): the build plan for the grown-ups' phone app,
  cut into packages for implementing agents.
- [decisions/](decisions/): the architecture decision records, including why this is a custom
  app rather than a Home Assistant dashboard.
- [design-review/](design-review/): the reviews, tournaments and panel measurements behind the
  layout and the idle screen.
- [scene-pipeline.md](scene-pipeline.md): how a generated picture is staged, validated and
  promoted without ever leaving the wall blank.
- [scene-imagery-plan.md](scene-imagery-plan.md): the 2026-09-12 model measurements that chose
  the image models.
- [scene-prompting-review.md](scene-prompting-review.md): the review of the scene prompt, with
  its measurements and costs.
- [image-prompts.md](image-prompts.md): the wording of the prompts for scenes and bands.
- [scene-ideas.md](scene-ideas.md): picture premises that were tried, and what each one
  measured.
- [scene-inputs.md](scene-inputs.md): the inputs a household can supply to improve its pictures.
- [calendar-structure.md](calendar-structure.md): the one-calendar-per-person convention.
- [chore-plan.md](chore-plan.md): the reasoning behind the chore catalog.
- [feature-landscape.md](feature-landscape.md): what the commercial family displays ship; its
  scope conclusion predates the narrowing to four jobs.
