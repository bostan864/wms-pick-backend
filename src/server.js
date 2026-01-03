import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// Supabase client (SERVICE ROLE – doar backend)
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Health check – primul test
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "wms-pick-backend" });
});

app.listen(PORT, () => {
  console.log(`WMS backend running on port ${PORT}`);
});
