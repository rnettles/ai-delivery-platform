#!/bin/sh
set -e

psql -v ON_ERROR_STOP=1 --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" <<-EOSQL
    SELECT 'CREATE DATABASE ai_orchestrator_dev_state OWNER $POSTGRES_USER'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_orchestrator_dev_state')\gexec
    SELECT 'CREATE DATABASE ai_orchestrator_dev_n8n OWNER $POSTGRES_USER'
    WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'ai_orchestrator_dev_n8n')\gexec
EOSQL
