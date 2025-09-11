#!/bin/bash
set -e

echo "📦 Installing dependencies..."
npm install

echo "🔒 Generating package-lock.json..."
npm install --package-lock-only

echo "➕ Staging changes..."
git add server.js package-lock.json

echo "💾 Committing changes..."
git commit -m "update" || echo "⚠️ Nothing to commit"

echo "📤 Pushing to GitHub..."
git push origin main

