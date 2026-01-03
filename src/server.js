import express from "express";
import cors from "cors";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

// 🔐 ENV
const PORT = process.env.PORT || 8080;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// 🧠 VALIDARE ENV – CRITIC
if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
  console.error("❌ Missing Supabase ENV vars");
  process.exit(1);
}

// 🔌 Supabase client (SERVICE ROLE)
const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

// =====================
// HEALTH CHECK
// =====================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "wms-pick-backend",
    time: new Date().toISOString()
  });
});

// =====================
// ORDERS LIST
// =====================
app.get("/orders/list", async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, status, total_amount")
      .eq("status", "pending")
      .order("order_number", { ascending: false });

    if (error) throw error;

    res.json(
      data.map(o => ({
        orderId: o.order_number,
        total_amount: o.total_amount
      }))
    );

  } catch (err) {
    console.error("❌ orders/list:", err);
    res.status(500).json({ error: "Failed to load orders" });
  }
});

// =====================
// ORDER GET (FĂRĂ PRODUSE DEOCAMDATĂ)
// =====================
app.get("/orders/get", async (req, res) => {
  const { orderId } = req.query;
  if (!orderId) {
    return res.status(400).json({ error: "Missing orderId" });
  }

  res.json({
    orderId,
    line_items: [] // 🔴 PASUL URMĂTOR
  });
});

// =====================
// DELETE / FINALIZE ORDER
// =====================
app.post("/orders/delete", async (req, res) => {
  const { orderId } = req.body;
  if (!orderId) {
    return res.status(400).json({ error: "Missing orderId" });
  }

  try {
    const { error } = await supabase
      .from("orders")
      .update({ status: "done" })
      .eq("order_number", orderId);

    if (error) throw error;

    res.json({ ok: true });

  } catch (err) {
    console.error("❌ orders/delete:", err);
    res.status(500).json({ error: "Failed to finalize order" });
  }
});

// =====================
// START SERVER
// =====================
app.listen(PORT, () => {
  console.log(`✅ WMS backend running on port ${PORT}`);
});

