import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* =========================
   SUPABASE (SERVICE ROLE)
   ========================= */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =========================
   HEALTH CHECK
   ========================= */
app.get("/health", (_, res) => {
  res.json({ status: "ok", service: "wms-pick-backend" });
});

/* =========================
   ORDERS LIST
   ========================= */
app.get("/orders/list", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) {
      return res.status(401).json({ error: "Missing Authorization" });
    }

    // 🔐 validăm userul
    const { data: userData, error: userErr } =
      await supabase.auth.getUser(auth.replace("Bearer ", ""));

    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // 🔑 account_id
    const { data: acc } = await supabase
      .from("user_accounts")
      .select("account_id")
      .eq("user_id", userData.user.id)
      .single();

    if (!acc) return res.json([]);

    // 📦 comenzi pending
    const { data: orders } = await supabase
      .from("orders")
      .select("order_number, total_amount, storage_path")
      .eq("account_id", acc.account_id)
      .eq("status", "pending")
      .order("created_at", { ascending: true });

    res.json(
      (orders || []).map(o => ({
        orderId: o.order_number,
        total_amount: o.total_amount,
        storage_path: o.storage_path
      }))
    );

  } catch (err) {
    console.error("orders/list:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   GET SINGLE ORDER
   ========================= */
app.get("/orders/get", async (req, res) => {
  try {
    const { orderId } = req.query;
    const auth = req.headers.authorization;

    if (!orderId || !auth) {
      return res.status(400).json({ error: "Missing params" });
    }

    const token = auth.replace("Bearer ", "");

    const { data: userData, error: userErr } =
      await supabase.auth.getUser(token);

    if (userErr || !userData?.user) {
      return res.status(401).json({ error: "Invalid token" });
    }

    // account
    const { data: acc } = await supabase
      .from("user_accounts")
      .select("account_id")
      .eq("user_id", userData.user.id)
      .single();

    // order row
    const { data: order } = await supabase
      .from("orders")
      .select("storage_path")
      .eq("order_number", orderId)
      .eq("account_id", acc.account_id)
      .single();

    if (!order) {
      return res.status(404).json({ error: "Order not found" });
    }

    // 📂 download order JSON from storage
    const { data: file, error: fileErr } =
      await supabase.storage
        .from("orders")
        .download(order.storage_path);

    if (fileErr) {
      return res.status(500).json({ error: "Storage read error" });
    }

    const text = await file.text();
    const json = JSON.parse(text);

    res.json(json);

  } catch (err) {
    console.error("orders/get:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* =========================
   DELETE / FINALIZE ORDER
   ========================= */
app.post("/orders/delete", async (req, res) => {
  try {
    const { orderId, accountId } = req.body;
    if (!orderId || !accountId) {
      return res.status(400).json({ error: "Missing data" });
    }

    await supabase
      .from("orders")
      .update({ status: "done" })
      .eq("order_number", orderId)
      .eq("account_id", accountId);

    res.json({ ok: true });
  } catch (err) {
    console.error("orders/delete:", err);
    res.status(500).json({ error: "Server error" });
  }
});

/* ========================= */
app.listen(PORT, () => {
  console.log("WMS backend running on", PORT);
});
