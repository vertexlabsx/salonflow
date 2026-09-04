module.exports = {
  apps: [
    {
      name: "solastio-api",
      cwd: "/opt/solastio/NEW SOLASTIO APP/app",
      script: "/opt/solastio/NEW SOLASTIO APP/app/target/release/solastio-api",
      exec_mode: "fork",
      instances: 1,
      autorestart: true,
      max_restarts: 10,
      restart_delay: 5000,
      env: {
        NODE_ENV: "production"
      },
      error_file: "/var/log/solastio/api-error.log",
      out_file: "/var/log/solastio/api-out.log",
      log_date_format: "YYYY-MM-DD HH:mm:ss Z"
    }
  ]
};
