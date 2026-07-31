#!/usr/bin/env node
import express from "express";
import cors from "cors";
import { router } from "./routes.mjs";

const app = express();
app.use(cors());
app.use(express.json());
app.use(router);

app.use((err, req, res, _next) => {
  console.error(err);
  res.status(500).json({ error: err.message });
});

const port = Number(process.env.PORT) || 3001;
app.listen(port, () => console.log(`video-reels-agent server listening on :${port}`));
