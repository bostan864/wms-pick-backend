import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

/* =========================
   ENV VALIDATION
========================= */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  PORT
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing ENV vars");
  process.exit(1);
}

/* =========================
   SUPABASE ADMIN CLIENT
========================= */
const supabaseAdmin = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   AUTH MIDDLEWARE (AICI!)
========================= */
async function authMiddleware(req, res, next) {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const token = authHeader.replace("Bearer ", "");

    const { data, error } = await supabaseAdmin.auth.getUser(token);

    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // EXTREM DE IMPORTANT
    req.user = {
      id: data.user.id, // UUID VALID
      email: data.user.email
    };

    next();
  } catch (err) {
    console.error("Auth middleware error:", err);
    res.status(401).json({ error: "Unauthorized" });
  }
}

/* =========================
   HEALTH CHECK
========================= */
app.get("/health", (_req, res) => {
  res.json({
    status: "ok",
    service: "wms-pick-backend",
    time: new Date().toISOString()
  });
});

/* =========================
   ORDERS LIST
========================= */
app.get("/orders/list", authMiddleware, async (req, res) => {
  try {
    const accountId = req.user.id;

    if (!accountId) {
      return res.status(400).json({ error: "Account ID missing" });
    }

    const { data, error } = await supabaseAdmin
      .from("orders")
      .select("id, order_number, total_amount, status")
      .eq("account_id", accountId)
      .order("order_number", { ascending: false });

    if (error) {
      console.error("Supabase orders error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    res.json(data);
  } catch (err) {
    console.error("Orders list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* =========================
   START SERVER
========================= */
app.listen(PORT || 8080, () => {
  console.log(`✅ WMS backend running on port ${PORT || 8080}`);
});





