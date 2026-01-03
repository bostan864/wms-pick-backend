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
// Orders list – proxy către Supabase Edge Function
app.get("/orders/list", async (req, res) => {
  try {
    const auth = req.headers.authorization;

    if (!auth) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const response = await fetch(
      "https://yvmqfsigxecmrygmbolg.supabase.co/functions/v1/orders-list",
      {
        headers: {
          Authorization: auth
        }
      }
    );

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("orders/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});
