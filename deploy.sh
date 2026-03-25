
#!/bin/bash
echo "🔨 Building..."
docker compose up -d --build

echo "📤 Pushing to Docker Hub..."
docker compose push

echo "✅ Deployed!"