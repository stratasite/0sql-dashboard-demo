import type { NextConfig } from 'next';

const config: NextConfig = {
  // DuckDB is a native module: keep it out of the bundler and require it at
  // runtime in the Node process that serves the route handlers.
  serverExternalPackages: ['@duckdb/node-api', '@duckdb/node-bindings'],
};

export default config;
