#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [ ! -x .venv/bin/python ]; then
  echo "First create the virtual environment and install requirements (see README.md)."
  exit 1
fi
exec .venv/bin/python app.py
