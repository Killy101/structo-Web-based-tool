#!/bin/bash
set -euo pipefail

TAG="${TAG:-$(git rev-parse --short HEAD)}"
export TAG

echo "Building production images (tag: ${TAG})..."
docker compose -f docker-compose.prod.yml build

echo "Pushing to Docker Hub..."
docker compose -f docker-compose.prod.yml push

echo "Done. Deploy with:"
echo "  TAG=${TAG} docker compose -f docker-compose.prod.yml up -d"
