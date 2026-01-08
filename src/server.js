import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

/* ===================== ENV ===================== */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET,
  PORT = 8080
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_JWT_SECRET) {
  console.error("❌ Missing ENV vars");
  process.exit(1);
}

/* ===================== APP ===================== */
const app = express();
app.use(cors());
app.use(express.json());

/* ===================== SUPABASE (SERVICE ROLE) ===================== */
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* ===================== AUTH ===================== */
function requireAuth(req, res, next) {
  const header = req.headers.authorization || "";
  const token = header.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Missing token" });
  }

  try {
    const payload = jwt.verify(token, SUPABASE_JWT_SECRET);
    req.userId = payload.sub;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* ===================== HEALTH ===================== */
app.get("/health", (_, res) => {
  res.json({ status: "ok", service: "wms-pick-backend" });
});

/* ===================== LIST ORDERS ===================== */
app.get("/orders/list", requireAuth, async (req, res) => {
  try {
    const { accountId } = req.query;
    if (!accountId) {
      return res.status(400).json({ error: "Missing accountId" });
    }

    const { data, error } = await supabase
      .from("orders")
      .select("order_number, total_amount")
      .eq("account_id", accountId)
      .eq("status", "pending")
      .order("order_number", { ascending: true });

    if (error) throw error;

    res.json(
      (data || []).map(o => ({
        orderId: o.order_number,
        total_amount: o.total_amount
      }))
    );
  } catch (err) {
    console.error("orders/list error:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

/* ===================== GET SINGLE ORDER ===================== */
app.get("/orders/get", requireAuth, async (req, res) => {
  try {
    const { orderId, accountId } = req.query;
    if (!orderId || !accountId) {
      return res.status(400).json({ error: "Invalid request" });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select("storage_path")
      .eq("account_id", accountId)
      .eq("order_number", orderId)
      .single();

    if (error || !order?.storage_path) {
      return res.status(404).json({ error: "Order not found" });
    }

    const { data: file, error: fileError } = await supabase
      .storage
      .from("comenzi")
      .download(order.storage_path);

    if (fileError) {
      console.error("Storage error:", fileError);
      return res.status(500).json({ error: "Failed to load order file" });
    }

    const text = await file.text();
    const json = JSON.parse(text);

    res.json(json);
  } catch (err) {
    console.error("orders/get error:", err);
    res.status(500).json({ error: "Failed to load order" });
  }
});

/* ===================== FINALIZE ORDER (DELETE STORAGE FILE) ===================== */
app.post("/orders/delete", requireAuth, async (req, res) => {
  try {
    const {
      orderId,
      accountId,
      orderAmount = 0,
      durationSeconds = 0
    } = req.body;

    if (!orderId || !accountId) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    /* 1️⃣ LUĂM STORAGE_PATH DIN ORDERS */
    const { data: orderRow, error: fetchError } = await supabase
      .from("orders")
      .select("storage_path")
      .eq("account_id", accountId)
      .eq("order_number", String(orderId))
      .single();

    if (fetchError || !orderRow) {
      return res.status(404).json({ error: "Order not found" });
    }

    /* 2️⃣ ȘTERGEM DOAR FIȘIERUL DIN STORAGE */
    if (orderRow.storage_path) {
      const { error: storageError } = await supabase
        .storage
        .from("comenzi")
        .remove([orderRow.storage_path]);

      // nu blocăm finalizarea dacă fișierul e deja șters
      if (storageError) {
        console.warn("Storage delete warning:", storageError.message);
      }
    }

    /* 3️⃣ MARCĂM COMANDA CA DONE */
    const { error: orderError } = await supabase
      .from("orders")
      .update({ status: "done" })
      .eq("account_id", accountId)
      .eq("order_number", orderId);

    if (orderError) throw orderError;

    /* 4️⃣ UPDATE DAILY STATS */
    const { error: statsError } = await supabase.rpc(
      "increment_daily_stats",
      {
        p_account_id: accountId,
        p_amount: Number(orderAmount) || 0,
        p_seconds: Number(durationSeconds) || 0
      }
    );

    if (statsError) throw statsError;

    res.json({ ok: true });

  } catch (err) {
    console.error("orders/delete error:", err);
    res.status(500).json({ error: "Failed to finalize order" });
  }
});

/* ===================== START ===================== */
app.listen(PORT, () => {
  console.log(`✅ WMS backend running on port ${PORT}`);
});







