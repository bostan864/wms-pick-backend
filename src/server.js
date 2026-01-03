import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

// ENV REQUIRED:
// SUPABASE_URL
// SUPABASE_SERVICE_ROLE_KEY
// ORDERS_BUCKET (optional, default: "orders")

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ORDERS_BUCKET = process.env.ORDERS_BUCKET || "orders";

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY in env");
  process.exit(1);
}

// Service Role client (backend only)
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false },
});

/* ===================== AUTH MIDDLEWARE ===================== */
async function requireUser(req, res, next) {
  try {
    const auth = req.headers.authorization || "";
    const token = auth.startsWith("Bearer ") ? auth.slice(7) : null;

    if (!token) {
      return res.status(401).json({ error: "Missing Bearer token" });
    }

    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data?.user) {
      return res.status(401).json({ error: "Invalid session token" });
    }

    req.user = data.user;
    req.accessToken = token;
    next();
  } catch (e) {
    console.error("Auth middleware error:", e);
    return res.status(500).json({ error: "Auth middleware failed" });
  }
}

async function getAccountIdForUser(userId) {
  const { data, error } = await supabase
    .from("user_accounts")
    .select("account_id")
    .eq("user_id", userId)
    .maybeSingle();

  if (error) throw error;
  if (!data?.account_id) return null;
  return data.account_id;
}

/* ===================== HEALTH ===================== */
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "wms-pick-backend" });
});

/* ===================== ORDERS LIST ===================== */
/**
 * Returns pending orders for the logged-in user's account.
 * Output format matches your frontend expectations: { orderId, total_amount, subtotal_amount }
 */
app.get("/orders/list", requireUser, async (req, res) => {
  try {
    const accountId = await getAccountIdForUser(req.user.id);
    if (!accountId) return res.status(403).json({ error: "No account mapped to user" });

    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, status, total_amount, storage_path, created_at")
      .eq("account_id", accountId)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    if (error) {
      console.error("orders/list db error:", error);
      return res.status(500).json({ error: "DB query failed" });
    }

    const out = (data || []).map((o) => ({
      id: o.id,
      orderId: o.order_number,              // frontend uses order.orderId
      status: o.status,
      total_amount: Number(o.total_amount || 0),
      subtotal_amount: Number(o.total_amount || 0),
      storage_path: o.storage_path || null, // useful for debugging
    }));

    return res.json(out);
  } catch (e) {
    console.error("orders/list error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ===================== ORDER GET ===================== */
/**
 * GET /orders/get?orderId=37960988
 * It finds the order in DB, downloads the JSON from Storage using storage_path, returns { line_items: [...] }
 */
app.get("/orders/get", requireUser, async (req, res) => {
  try {
    const orderId = String(req.query.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const accountId = await getAccountIdForUser(req.user.id);
    if (!accountId) return res.status(403).json({ error: "No account mapped to user" });

    const { data: order, error: orderErr } = await supabase
      .from("orders")
      .select("id, order_number, storage_path")
      .eq("account_id", accountId)
      .eq("order_number", orderId)
      .maybeSingle();

    if (orderErr) {
      console.error("orders/get db error:", orderErr);
      return res.status(500).json({ error: "DB query failed" });
    }

    if (!order) return res.status(404).json({ error: "Order not found" });
    if (!order.storage_path) return res.status(400).json({ error: "Order has no storage_path" });

    // Download JSON file from Storage
    const { data: fileData, error: dlErr } = await supabase.storage
      .from(ORDERS_BUCKET)
      .download(order.storage_path);

    if (dlErr) {
      console.error("orders/get storage download error:", dlErr, "path:", order.storage_path);
      return res.status(500).json({ error: "Storage download failed", path: order.storage_path });
    }

    const text = await fileData.text();
    let json;
    try {
      json = JSON.parse(text);
    } catch (parseErr) {
      console.error("orders/get JSON parse error:", parseErr);
      return res.status(500).json({ error: "Invalid JSON in storage file" });
    }

    // Ensure response contains line_items array (your frontend expects that)
    if (!json.line_items) json.line_items = [];

    return res.json(json);
  } catch (e) {
    console.error("orders/get error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ===================== ORDER DELETE / FINALIZE ===================== */
/**
 * POST /orders/delete
 * body: { orderId: "37960988" }
 * Marks order as done in DB (and keeps storage_path intact)
 */
app.post("/orders/delete", requireUser, async (req, res) => {
  try {
    const orderId = String(req.body?.orderId || "").trim();
    if (!orderId) return res.status(400).json({ error: "Missing orderId" });

    const accountId = await getAccountIdForUser(req.user.id);
    if (!accountId) return res.status(403).json({ error: "No account mapped to user" });

    const { error } = await supabase
      .from("orders")
      .update({ status: "done" })
      .eq("account_id", accountId)
      .eq("order_number", orderId);

    if (error) {
      console.error("orders/delete update error:", error);
      return res.status(500).json({ error: "Update failed" });
    }

    return res.json({ ok: true });
  } catch (e) {
    console.error("orders/delete error:", e);
    return res.status(500).json({ error: "Internal server error" });
  }
});

/* ===================== START ===================== */
app.listen(PORT, () => {
  console.log(`WMS backend running on port ${PORT}`);
  console.log(`ORDERS_BUCKET = ${ORDERS_BUCKET}`);
});
