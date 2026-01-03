import express from "express";
import cors from "cors";
import jwt from "jsonwebtoken";
import { createClient } from "@supabase/supabase-js";

// =======================
// ENV VALIDATION
// =======================
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  SUPABASE_JWT_SECRET,
  PORT
} = process.env;

if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY || !SUPABASE_JWT_SECRET) {
  console.error("❌ Missing ENV vars");
  process.exit(1);
}

// =======================
// INIT
// =======================
const app = express();
app.use(cors());
app.use(express.json());

const supabase = createClient(
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY
);

const JWT_SECRET = SUPABASE_JWT_SECRET;

// =======================
// AUTH MIDDLEWARE
// =======================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization || "";
  const token = authHeader.replace("Bearer ", "");

  if (!token) {
    return res.status(401).json({ error: "Missing Authorization token" });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);

    const accountId =
      decoded.account_id ||
      decoded.user_metadata?.account_id ||
      decoded.app_metadata?.account_id;

    if (!accountId) {
      console.error("❌ account_id missing in JWT", decoded);
      return res.status(401).json({ error: "Invalid token" });
    }

    req.user = {
      userId: decoded.sub,
      accountId
    };

    next();
  } catch (err) {
    console.error("JWT error:", err.message);
    return res.status(401).json({ error: "Invalid token" });
  }
}

// =======================
// HEALTH CHECK
// =======================
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    service: "wms-pick-backend",
    time: new Date().toISOString()
  });
});

// =======================
// LIST ORDERS (WMS)
// ONLY PENDING = DE PREGĂTIT
// =======================
app.get("/orders/list", authMiddleware, async (req, res) => {
  try {
    const { data, error } = await supabase
      .from("orders")
      .select("id, order_number, total_amount, status")
      .eq("account_id", req.user.accountId)
      .eq("status", "pending")
      .order("created_at", { ascending: false });

    if (error) {
      console.error("Supabase error:", error);
      return res.status(500).json({ error: "Database error" });
    }

    return res.json(data || []);
  } catch (err) {
    console.error("Orders list error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// =======================
// GET SINGLE ORDER
// =======================
app.get("/orders/get", authMiddleware, async (req, res) => {
  const { orderNumber } = req.query;

  if (!orderNumber) {
    return res.status(400).json({ error: "Missing orderNumber" });
  }

  try {
    const { data, error } = await supabase
      .from("orders")
      .select("*")
      .eq("account_id", req.user.accountId)
      .eq("order_number", orderNumber)
      .single();

    if (error || !data) {
      return res.status(404).json({ error: "Order not found" });
    }

    return res.json(data);
  } catch (err) {
    console.error("Get order error:", err);
    return res.status(500).json({ error: "Internal server error" });
  }
});

// =======================
// START SERVER
// =======================
const listenPort = PORT || 8080;

app.listen(listenPort, () => {
  console.log(`✅ WMS backend running on port ${listenPort}`);
});






