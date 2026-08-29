module.exports = {
  apps: [
    {
      name: "salonflow-api",
      cwd: "/opt/salonflow/server",
      script: "dist/src/index.js",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      },
      error_file: "/var/log/salonflow/api-error.log",
      out_file: "/var/log/salonflow/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
