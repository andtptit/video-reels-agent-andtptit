#!/usr/bin/env node
import express from "express";
import cors from "cors";
import { router } from "./routes.mjs";
import { listProjects, resolveProjectDir } from "./lib/project-id.mjs";
import { reconcileInterruptedSteps } from "./jobs/job-status.mjs";

const app = express();
app.use(cors());
app.use(express.json());
app.use(router);

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

// Any step still "running" in job-status.json belonged to a process that no longer
// exists (this one just started) — see reconcileInterruptedSteps's doc for the real
// incident this fixes (a render stuck "running" for hours, permanently unclickable
// in the UI, after a routine server restart).
for (const { id } of listProjects()) {
  reconcileInterruptedSteps(resolveProjectDir(id));
}

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`video-reels-agent server listening on :${port}`));
