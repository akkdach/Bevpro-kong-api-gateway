/**
 * 🔌 Kong Log Receiver Service
 *
 * รับ JSON log จาก Kong HTTP Log Plugin แบบ Asynchronous
 * สะสมใน Memory Queue → Batch Insert ลง PostgreSQL ทุก 5 วินาที
 *
 * Features:
 *   - Memory queue with configurable batch size
 *   - Auto-flush every N seconds
 *   - Transaction-based batch insert (COMMIT/ROLLBACK)
 *   - Failed logs re-queued for retry
 *   - Health check endpoint
 *   - Graceful shutdown
 */

const express = require("express");
const { Pool } = require("pg");

const app = express();
app.use(express.json({ limit: "10mb" })); // Kong can send large payloads

// ─── Configuration ────────────────────────────────
const PORT = parseInt(process.env.PORT || "3001", 10);
const BATCH_SIZE = parseInt(process.env.BATCH_SIZE || "100", 10);
const FLUSH_INTERVAL_MS = parseInt(process.env.FLUSH_INTERVAL_MS || "5000", 10);
const MAX_QUEUE_SIZE = parseInt(process.env.MAX_QUEUE_SIZE || "50000", 10);

// ─── Database Pool ────────────────────────────────
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 5,               // Max connections in pool
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

// ─── In-Memory Log Queue ──────────────────────────
let logQueue = [];
let totalReceived = 0;
let totalFlushed = 0;
let totalErrors = 0;
let isShuttingDown = false;

// ─── Parse Kong Log Entry ─────────────────────────
function parseKongLog(log) {
  try {
    return {
      request_id:
        log.request?.headers?.["kong-request-id"] ||
        log.tries?.[0]?.id ||
        `auto_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      client_ip: log.client_ip || "unknown",
      method: log.request?.method || "UNKNOWN",
      path: log.request?.uri || "/",
      status_code: log.response?.status || 0,
      latency_ms: log.latencies?.request || 0,
      consumer_username: log.consumer?.username || "anonymous",
      user_agent: log.request?.headers?.["user-agent"] || "",
      request_body: null, // ไม่เก็บ body เพื่อประหยัดพื้นที่
      response_size: log.response?.size || 0,
      service_name: log.service?.name || null,
      route_name: log.route?.name || null,
      request_time: log.started_at
        ? new Date(log.started_at)
        : new Date(),
    };
  } catch (err) {
    console.error("⚠️ Failed to parse log entry:", err.message);
    return null;
  }
}

// ─── Flush Queue to PostgreSQL ────────────────────
async function flushLogs() {
  if (logQueue.length === 0) return;

  const workingQueue = [...logQueue];
  logQueue = [];

  const batchSize = workingQueue.length;
  console.log(
    `💾 Flushing ${batchSize} logs to PostgreSQL... (Queue remaining: ${logQueue.length})`
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const insertSQL = `
      INSERT INTO kong_api_logs 
        (request_id, client_ip, method, path, status_code, latency_ms, 
         consumer_username, user_agent, request_body, response_size,
         service_name, route_name, request_time) 
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13) 
      ON CONFLICT (request_id) DO NOTHING
    `;

    for (const item of workingQueue) {
      await client.query(insertSQL, [
        item.request_id,
        item.client_ip,
        item.method,
        item.path,
        item.status_code,
        item.latency_ms,
        item.consumer_username,
        item.user_agent,
        item.request_body,
        item.response_size,
        item.service_name,
        item.route_name,
        item.request_time,
      ]);
    }

    await client.query("COMMIT");
    totalFlushed += batchSize;
    console.log(
      `✅ Batch committed: ${batchSize} logs (Total flushed: ${totalFlushed})`
    );
  } catch (err) {
    await client.query("ROLLBACK");
    totalErrors++;
    console.error(`❌ Batch insert failed: ${err.message}`);

    // Re-queue failed logs for retry (with size limit)
    if (logQueue.length + workingQueue.length <= MAX_QUEUE_SIZE) {
      logQueue = [...workingQueue, ...logQueue];
      console.log(`🔄 Re-queued ${batchSize} logs for retry`);
    } else {
      console.error(
        `⚠️ Queue overflow! Dropping ${batchSize} logs to prevent OOM`
      );
    }
  } finally {
    client.release();
  }
}

// ─── API Endpoints ────────────────────────────────

// Kong HTTP Log Plugin sends logs here
app.post("/logs", (req, res) => {
  if (isShuttingDown) {
    return res.status(503).json({ error: "Shutting down" });
  }

  const log = req.body;
  const parsed = parseKongLog(log);

  if (parsed) {
    // Guard against queue overflow
    if (logQueue.length >= MAX_QUEUE_SIZE) {
      console.warn("⚠️ Queue full! Dropping oldest entries...");
      logQueue = logQueue.slice(Math.floor(MAX_QUEUE_SIZE / 2));
    }

    logQueue.push(parsed);
    totalReceived++;

    // Auto-flush if batch size reached
    if (logQueue.length >= BATCH_SIZE) {
      flushLogs().catch((err) =>
        console.error("Auto-flush error:", err.message)
      );
    }
  }

  // ส่ง 202 Accepted ทันทีเพื่อไม่ให้ Kong รอ
  res.status(202).json({ status: "accepted" });
});

// Health check
app.get("/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({
      status: "healthy",
      queue_size: logQueue.length,
      total_received: totalReceived,
      total_flushed: totalFlushed,
      total_errors: totalErrors,
      uptime_seconds: Math.floor(process.uptime()),
    });
  } catch (err) {
    res.status(503).json({
      status: "unhealthy",
      error: err.message,
    });
  }
});

// Stats endpoint
app.get("/stats", (req, res) => {
  res.json({
    queue_size: logQueue.length,
    total_received: totalReceived,
    total_flushed: totalFlushed,
    total_errors: totalErrors,
    config: {
      batch_size: BATCH_SIZE,
      flush_interval_ms: FLUSH_INTERVAL_MS,
      max_queue_size: MAX_QUEUE_SIZE,
    },
    uptime_seconds: Math.floor(process.uptime()),
  });
});

// ─── Periodic Flush Timer ─────────────────────────
const flushTimer = setInterval(() => {
  flushLogs().catch((err) =>
    console.error("Periodic flush error:", err.message)
  );
}, FLUSH_INTERVAL_MS);

// ─── Graceful Shutdown ────────────────────────────
async function gracefulShutdown(signal) {
  console.log(`\n🛑 ${signal} received — Starting graceful shutdown...`);
  isShuttingDown = true;
  clearInterval(flushTimer);

  // Flush remaining logs
  if (logQueue.length > 0) {
    console.log(`💾 Final flush: ${logQueue.length} remaining logs...`);
    await flushLogs();
  }

  await pool.end();
  console.log("✅ Shutdown complete.");
  process.exit(0);
}

process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// ─── Start Server ─────────────────────────────────
app.listen(PORT, () => {
  console.log("╔══════════════════════════════════════════════╗");
  console.log("║   🔌 Kong Log Receiver Service              ║");
  console.log("╠══════════════════════════════════════════════╣");
  console.log(`║   Port:           ${PORT}                       ║`);
  console.log(`║   Batch Size:     ${BATCH_SIZE}                      ║`);
  console.log(`║   Flush Interval: ${FLUSH_INTERVAL_MS}ms                  ║`);
  console.log(`║   Max Queue:      ${MAX_QUEUE_SIZE}                    ║`);
  console.log("╚══════════════════════════════════════════════╝");
});
