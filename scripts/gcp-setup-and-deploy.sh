#!/usr/bin/env bash
set -euo pipefail

# ==============================================================================
# MiraiStudy — GCP Always Free Setup & Cloud Run Deploy Script
# Requires: gcloud CLI authenticated with target GCP project.
# Secrets (NUXT_OPENAI_API_KEY, NUXT_SSO_SHARED_SECRET, NUXT_A2A_SHARED_SECRET)
# MUST be stored in Secret Manager and injected via --set-secrets.
# ==============================================================================

PROJECT_ID="${GCP_PROJECT_ID:?Set GCP_PROJECT_ID before running}"
REGION="${GCP_REGION:-us-central1}"
SERVICE_NAME="${CLOUD_RUN_SERVICE:-mirai-study}"
GCS_BUCKET_NAME="${NUXT_GCS_BUCKET_NAME:?Set NUXT_GCS_BUCKET_NAME before running}"

echo "==> Configuring gcloud project: ${PROJECT_ID} (region: ${REGION})"
gcloud config set project "${PROJECT_ID}"

echo "==> Enabling required GCP APIs..."
gcloud services enable \
  run.googleapis.com \
  artifactregistry.googleapis.com \
  cloudbuild.googleapis.com \
  firestore.googleapis.com \
  storage.googleapis.com \
  secretmanager.googleapis.com

echo "==> Deploying ${SERVICE_NAME} to Cloud Run (Always Free tuned: min=0, max=2, 512Mi)..."
gcloud run deploy "${SERVICE_NAME}" \
  --source . \
  --region "${REGION}" \
  --platform managed \
  --allow-unauthenticated \
  --min-instances 0 \
  --max-instances 2 \
  --memory 512Mi \
  --cpu 1 \
  --set-env-vars "NUXT_GCP_PROJECT_ID=${PROJECT_ID},NUXT_GCS_BUCKET_NAME=${GCS_BUCKET_NAME},NUXT_OPENAI_MODEL=gpt-4.1-mini" \
  --set-secrets "NUXT_OPENAI_API_KEY=miraistudy-openai-api-key:latest"

echo "==> Deployment finished."
