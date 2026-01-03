import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";
import { createClient } from "@supabase/supabase-js";

/* =====================
   ENV
===================== */
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

/* =====================
   APP
===================== */
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* =====================
   AUTH MIDDLEWARE
===================== */
function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    const payload = jwt.verify(token, SUPABASE_JWT_SECRET);

    // user_id din Supabase Auth
    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* =====================
   USER → ACCOUNT
===================== */
async function getAccountIdForUser(userId) {
  const { data, error } = await supabase
    .from("user_accounts")
    .select("account_id")
    .eq("user_id", userId)
    .single();

  if (error || !data?.account_id) {
    throw new Error("Account not found for user");
  }

  return data.account_id;
}

/* =====================
   HEALTH
===================== */
app.get("/health", (_, res) => {
  res.json({
    status: "ok",
    service: "wms-pick-backend",
    time: new Date().toISOString()
  });
});

/* =====================
   LIST ORDERS (PENDING)
===================== */
app.get("/orders/list", requireAuth, async (req, res) => {
  try {
    const accountId = await getAccountIdForUser(req.userId);

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
    console.error("❌ orders/list:", err.message);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

/* =====================
   GET SINGLE ORDER
===================== */
app.get("/orders/get", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const accountId = await getAccountIdForUser(req.userId);

    const { data: order, error } = await supabase
      .from("orders")
      .select("storage_path")
      .eq("account_id", accountId)
      .eq("order_number", orderId)
      .single();

    if (error || !order?.storage_path) {
      return res.status(404).json({ error: "Order not found" });
    }

    const filePath = path.join("/data", order.storage_path);
    const json = JSON.parse(await fs.readFile(filePath, "utf8"));

    res.json(json);
  } catch (err) {
    console.error("❌ orders/get:", err.message);
    res.status(500).json({ error: "Failed to load order" });
  }
});

/* =====================
   FINALIZE / CANCEL ORDER
===================== */
app.post("/orders/delete", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.body;
    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const accountId = await getAccountIdForUser(req.userId);

    const { error } = await supabase
      .from("orders")
      .update({ status: "done" })
      .eq("account_id", accountId)
      .eq("order_number", orderId);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error("❌ orders/delete:", err.message);
    res.status(500).json({ error: "Failed to update order" });
  }
});

/* =====================
   START
===================== */
app.listen(PORT, () => {
  console.log(`✅ WMS backend running on port ${PORT}`);
});








