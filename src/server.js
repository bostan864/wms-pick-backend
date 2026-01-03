import express from "express";
import cors from "cors";
import fetch from "node-fetch";
import { createClient } from "@supabase/supabase-js";

const app = express();
app.use(cors());
app.use(express.json());

const PORT = process.env.PORT || 8080;

/* =====================
   SUPABASE (SERVICE ROLE)
   ===================== */
const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

/* =====================
   HEALTH CHECK
   ===================== */
app.get("/health", (req, res) => {
  res.json({ status: "ok", service: "wms-pick-backend" });
});

/* =====================
   LISTĂ COMENZI (proxy → Edge Function)
   ===================== */
app.get("/orders/list", async (req, res) => {
  try {
    const auth = req.headers.authorization;
    if (!auth) {
      return res.status(401).json({ error: "Missing Authorization header" });
    }

    const response = await fetch(
      "https://yvmqfsigxecmrygmbolg.supabase.co/functions/v1/orders-list",
      {
        headers: { Authorization: auth }
      }
    );

    if (!response.ok) {
      return res.status(500).json({ error: "Orders list fetch failed" });
    }

    const data = await response.json();
    res.json(data);

  } catch (err) {
    console.error("orders/list error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* =====================
   DETALII COMANDĂ + PRODUSE
   (citește JSON din Storage folosind storage_path)
   ===================== */
app.get("/orders/get", async (req, res) => {
  try {
    const { orderId } = req.query;
    if (!orderId) {
      return res.status(400).json({ error: "Missing orderId" });
    }

    /* 1️⃣ citim storage_path din tabela orders */
    const { data: order, error } = await supabase
      .from("orders")
      .select("storage_path")
      .eq("order_number", orderId)
      .single();

    if (error || !order?.storage_path) {
      return res.status(404).json({ error: "Order not found" });
    }

    /* 2️⃣ citim fișierul JSON din Storage */
    const { data: file, error: fileError } = await supabase
      .storage
      .from("orders")
      .download(order.storage_path);

    if (fileError || !file) {
      return res.status(500).json({ error: "Cannot read order file" });
    }

    /* 3️⃣ parse JSON */
    const text = await file.text();
    const json = JSON.parse(text);

    /* 4️⃣ trimitem EXACT ce așteaptă frontend-ul */
    res.json(json);

  } catch (err) {
    console.error("orders/get error:", err);
    res.status(500).json({ error: "Internal server error" });
  }
});

/* =====================
   FINALIZARE / ANULARE COMANDĂ
   (temporar – doar confirmare)
   ===================== */
app.post("/orders/delete", async (req, res) => {
  res.json({ ok: true });
});

/* =====================
   START SERVER
   ===================== */
app.listen(PORT, () => {
  console.log(`✅ WMS backend running on port ${PORT}`);
});
