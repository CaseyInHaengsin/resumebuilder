#!/bin/bash
set -e

# Deployment settings that should not be committed live in .env.deploy.
if [ -f .env.deploy ]; then
  set -a
  . ./.env.deploy
  set +a
fi

DOCKERHUB_USERNAME="${DOCKERHUB_USERNAME:-caseyinhaengsin}"

if [ -z "${ALLOWED_ACTION_ORIGINS:-}" ]; then
  echo "ALLOWED_ACTION_ORIGINS is not set." >&2
  echo "Put the public host in .env.deploy, for example:" >&2
  echo "  ALLOWED_ACTION_ORIGINS=resume.example.com" >&2
  echo "Without it every form post fails behind the reverse proxy." >&2
  exit 1
fi
IMAGE_NAME="resume-builder-web"
VERSION="${1:-latest}"

FULL_IMAGE_NAME="${DOCKERHUB_USERNAME}/${IMAGE_NAME}:${VERSION}"

echo "Building Docker image: ${FULL_IMAGE_NAME}"
docker build --platform linux/amd64 \
  --build-arg ALLOWED_ACTION_ORIGINS="${ALLOWED_ACTION_ORIGINS}" \
  -t "${FULL_IMAGE_NAME}" .

if [ "${VERSION}" != "latest" ]; then
  echo "Tagging as latest..."
  docker tag "${FULL_IMAGE_NAME}" "${DOCKERHUB_USERNAME}/${IMAGE_NAME}:latest"
fi

echo "Pushing to DockerHub..."
docker push "${FULL_IMAGE_NAME}"
if [ "${VERSION}" != "latest" ]; then
  docker push "${DOCKERHUB_USERNAME}/${IMAGE_NAME}:latest"
fi

echo "✓ Build and push complete!"
echo "Image: ${FULL_IMAGE_NAME}"
echo ""
echo "Deploy on the server with docker-compose.prod.yml or via Portainer."
