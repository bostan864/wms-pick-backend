import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

/* =====================
   BASIC APP SETUP
===================== */
const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* =====================
   ENV VALIDATION
===================== */
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_JWT_SECRET) {
  console.error("❌ Missing Supabase ENV vars");
  process.exit(1);
}

/* =====================
   SUPABASE CLIENT
===================== */
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

/* =====================
   AUTH MIDDLEWARE
   - validează JWT Supabase
   - injectează user_id + account_id
===================== */
async function authMiddleware(req, res, next) {
  try {
    const auth = req.headers.authorization;
    if (!auth?.startsWith("Bearer ")) {
      return res.status(401).json({ error: "Missing auth token" });
    }

    const token = auth.replace("Bearer ", "");
    const decoded = jwt.verify(token, SUPABASE_JWT_SECRET);

    const userId = decoded.sub;
    if (!userId) {
      return res.status(401).json({ error: "Invalid token" });
    }

    const { data, error } = await supabase
      .from("user_accounts")
      .select("account_id")
      .eq("user_id", userId)
      .single();

    if (error || !data) {
      return res.status(403).json({ error: "Account not found" });
    }

    req.user = {
      userId,
      accountId: data.account_id
    };

    next();

  } catch (err) {
    console.error("❌ Auth error:", err.message);
    res.status(401).json({ error: "Unauthorized" });
  }
}

/* =====================
   HEALTH CHECK
===================== */
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "wms-pick-backend",
    time: new Date().toISOString()
  });
});

/* =====================
   GET ORDERS LIST
   (pending only, account scoped)
===================== */
app.get("/orders/list", authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.user;

    const { data, error } = await supabase
      .from("orders")
      .select("order_number, total_amount")
      .eq("status", "pending")
      .eq("account_id", accountId)
      .order("order_number", { ascending: false });

    if (error) throw error;

    res.json(
      (data || []).map(o => ({
        orderId: o.order_number,
        total_amount: o.total_amount
      }))
    );

  } catch (err) {
    console.error("❌ orders/list:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

/* =====================
   GET SINGLE ORDER
   (with products)
===================== */
app.get("/orders/get", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.query;
    const { accountId } = req.user;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select(`
        order_number,
        order_items (
          product_sku,
          product_name,
          product_ean,
          quantity,
          item_type
        )
      `)
      .eq("order_number", orderId)
      .eq("account_id", accountId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    res.json({
      orderId: order.order_number,
      line_items: order.order_items || []
    });

  } catch (err) {
    console.error("❌ orders/get:", err);
    res.status(500).json({ error: "Failed to load order" });
  }
});

/* =====================
   FINALIZE ORDER
===================== */
app.post("/orders/delete", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.body;
    const { accountId } = req.user;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const { error } = await supabase
      .from("orders")
      .update({ status: "done" })
      .eq("order_number", orderId)
      .eq("account_id", accountId);

    if (error) throw error;

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ orders/delete:", err);
    res.status(500).json({ error: "Failed to finalize order" });
  }
});

/* =====================
   START SERVER
===================== */
app.listen(PORT, () => {
  console.log(`✅ WMS backend running on port ${PORT}`);
});


