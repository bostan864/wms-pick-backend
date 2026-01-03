import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// =====================
// ENV
// =====================
const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const JWT_SECRET = process.env.SUPABASE_JWT_SECRET;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !JWT_SECRET) {
  console.error("❌ Missing ENV vars");
  process.exit(1);
}

// =====================
// SUPABASE CLIENT
// =====================
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// =====================
// AUTH MIDDLEWARE
// =====================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    req.user = {
      userId: decoded.sub,
      accountId: decoded.account_id
    };

    next();
  } catch (err) {
    console.error("JWT error:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// =====================
// HEALTH
// =====================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "wms-pick-backend",
    time: new Date().toISOString()
  });
});

// =====================
// ORDERS LIST (CORECT)
// =====================
app.get("/orders/list", authMiddleware, async (req, res) => {
  try {
    const { accountId } = req.user;

    const { data, error } = await supabase
      .from("orders")
      .select("order_number, total_amount, status")
      .eq("account_id", accountId)
      .order("order_number", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Failed to load orders" });
    }

    res.json(
      (data || []).map(o => ({
        orderId: o.order_number,
        total_amount: o.total_amount,
        status: o.status
      }))
    );
  } catch (err) {
    console.error("orders/list:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// =====================
// ORDER GET (DIN STORAGE)
// =====================
app.get("/orders/get", authMiddleware, async (req, res) => {
  try {
    const { orderId } = req.query;
    const { accountId } = req.user;

    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    const { data: order, error } = await supabase
      .from("orders")
      .select("order_number, storage_path")
      .eq("order_number", orderId)
      .eq("account_id", accountId)
      .single();

    if (error || !order) {
      return res.status(404).json({ error: "Order not found" });
    }

    if (!order.storage_path) {
      return res.json({ orderId, line_items: [] });
    }

    const { data: file, error: fileError } = await supabase
      .storage
      .from("comenzi")
      .download(order.storage_path);

    if (fileError) {
      console.error("Storage error:", fileError);
      return res.status(500).json({ error: "Failed to read order file" });
    }

    const raw = await file.text();
    const payload = JSON.parse(raw);

    const items = (payload.line_items || []).filter(
      i => i.item_type === "product"
    );

    res.json({
      orderId: order.order_number,
      line_items: items
    });
  } catch (err) {
    console.error("orders/get:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// =====================
// FINALIZE ORDER
// =====================
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

    if (error) {
      console.error("Finalize error:", error);
      return res.status(500).json({ error: "Failed to finalize order" });
    }

    res.json({ ok: true });
  } catch (err) {
    console.error("orders/delete:", err);
    res.status(500).json({ error: "Internal error" });
  }
});

// =====================
// START
// =====================
app.listen(PORT, () => {
  console.log(`✅ WMS backend running on port ${PORT}`);
});




