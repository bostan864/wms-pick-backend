import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import fs from "fs/promises";
import path from "path";
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

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* ===================== AUTH ===================== */
function requireAuth(req, res, next) {
  try {
    const header = req.headers.authorization || "";
    const token = header.replace("Bearer ", "");

    if (!token) {
      return res.status(401).json({ error: "Missing token" });
    }

    const payload = jwt.verify(token, SUPABASE_JWT_SECRET);

    req.userId = payload.sub;
    next();
  } catch (err) {
    return res.status(401).json({ error: "Invalid token" });
  }
}

/* ===================== HEALTH ===================== */
app.get("/health", (_, res) => {
  res.json({ status: "ok", service: "wms-pick-backend" });
});

/* ===================== LIST ORDERS ===================== */
/**
 * RETURNĂ DOAR:
 * - account_id = user account
 * - status = pending
 */
app.get("/orders/list", requireAuth, async (req, res) => {
  try {
    const accountId = req.headers["x-account-id"];

    if (!accountId) {
      return res.status(400).json({ error: "Missing account id" });
    }

    const { data, error } = await supabase
      .from("orders")
      .select("order_number, total_amount")
      .eq("account_id", accountId)
      .eq("status", "pending")
      .order("order_number", { ascending: true });

    if (error) throw error;

    const orders = (data || []).map(o => ({
      orderId: o.order_number,
      total_amount: o.total_amount
    }));

    res.json(orders);
  } catch (err) {
    console.error("orders/list error:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

/* ===================== GET SINGLE ORDER ===================== */
app.get("/orders/get", requireAuth, async (req, res) => {
  try {
    const { orderId } = req.query;
    const accountId = req.headers["x-account-id"];

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

    const filePath = path.join("/data", order.storage_path);
    const json = JSON.parse(await fs.readFile(filePath, "utf8"));

    res.json(json);
  } catch (err) {
    console.error("orders/get error:", err);
    res.status(500).json({ error: "Failed to load order" });
  }
});

/* ===================== DELETE (FINALIZE / CANCEL) ===================== */
app.post("/orders/delete", requireAuth, async (req, res) => {
  try {
    const { orderId, accountId } = req.body;

    if (!orderId || !accountId) {
      return res.status(400).json({ error: "Invalid payload" });
    }

    const { error } = await supabase
      .from("orders")
      .update({ status: "done" })
      .eq("account_id", accountId)
      .eq("order_number", orderId);

    if (error) throw error;

    res.json({ ok: true });
  } catch (err) {
    console.error("orders/delete error:", err);
    res.status(500).json({ error: "Failed to update order" });
  }
});

/* ===================== START ===================== */
app.listen(PORT, () => {
  console.log(`✅ WMS backend running on port ${PORT}`);
});







