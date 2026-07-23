# HRM Reference Roadmap

- [x] Rework warehouse quality checks to use measured runtime state instead of recipe-only approximations.
  Capture stage-exit measurements on the batch, keep them in memory for deterministic testing, and inspect against quality specs from those measured values.
- [x] Add read-side assistant patterns for HRM.
  Expose the published model cleanly through `uns-api-global`, then add seeded assistant/eval scenarios in `uns-datahub-controller` against realistic QuestDB history.
- [x] Add a stronger production troubleshooting model.
  Introduce alarm/event examples and keep the split between live state, active lifecycle, and history explicit so UI liveliness and analytics stay coherent.
