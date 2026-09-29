// pm2 process file for production (EC2). See docs/deploy-pm2.md.
//
//   pm2 start ecosystem.config.cjs --env production
//   pm2 reload chroney --update-env
//
// Single instance in fork mode: background schedulers (campaigns, backups,
// CRM retries, TopScholar pollers...) run in-process and must not run twice,
// so do NOT switch to cluster mode / instances > 1.
const os = require("os");
const path = require("path");

const LOG_DIR = process.env.PM2_LOG_DIR || path.join(os.homedir(), ".pm2", "logs");

// Optional: load secrets from a dotenv-style file via Node's --env-file
// (Node >= 20.6). Otherwise the app inherits the environment of the shell that
// runs `pm2 start` / `pm2 reload --update-env`.
const envFile = process.env.CHRONEY_ENV_FILE;

module.exports = {
  apps: [
    {
      name: "chroney",
      cwd: __dirname,
      script: "dist/index.js",
      node_args: envFile ? [`--env-file=${envFile}`] : [],
      exec_mode: "fork",
      instances: 1,

      autorestart: true,
      // Back off on crash loops (100ms, 150ms, ... up to 15s) instead of hammering.
      exp_backoff_restart_delay: 100,
      max_restarts: 50,
      min_uptime: "30s",
      // Restart before the box starts swapping. Size to the instance's RAM.
      max_memory_restart: process.env.PM2_MAX_MEMORY || "1500M",

      // pm2 sends SIGINT on stop/restart/reload; the app drains in-flight
      // requests for up to SHUTDOWN_DRAIN_MS (25s) and hard-exits by drain+8s
      // (33s). Give it a little more before pm2 escalates to SIGKILL.
      kill_timeout: 35000,

      out_file: path.join(LOG_DIR, "chroney-out.log"),
      error_file: path.join(LOG_DIR, "chroney-error.log"),
      merge_logs: true,
      time: true,

      env_production: {
        NODE_ENV: "production",
        SHUTDOWN_DRAIN_MS: "25000",
      },
    },
  ],
};
