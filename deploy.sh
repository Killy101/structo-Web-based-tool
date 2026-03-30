#!/bin/bash
echo "🔨 Building..."
docker compose build

echo "📤 Pushing to Docker Hub..."
docker compose push

echo "✅ Pushed to Docker Hub!"