#!/usr/bin/env bash

set -euo pipefail

# Get the directory where the script lives
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

DB_FILE="$SCRIPT_DIR/expenses.db"
BACKUP_DIR="$SCRIPT_DIR/backups"
DATE="$(date +%Y-%m-%d_%H-%M-%S)"

mkdir -p "$BACKUP_DIR"

cp "$DB_FILE" "$BACKUP_DIR/expenses_${DATE}.db"
