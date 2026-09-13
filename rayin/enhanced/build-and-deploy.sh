#!/bin/bash
set -e

echo "🚀 Building and deploying enhanced RAYIN + NeMo Guardrails integration..."

# Build and push Docker image
echo "📦 Building Docker image..."
cd "$(dirname "$0")"
docker build -t acmelangfuseacr.azurecr.io/rayin-enhanced:v2.0-nemo .

echo "🔑 Logging into ACR..."
az acr login --name acmelangfuseacr

echo "📤 Pushing image to ACR..."
docker push acmelangfuseacr.azurecr.io/rayin-enhanced:v2.0-nemo

echo "🎯 Deploying to Kubernetes..."
kubectl apply -f enhanced-deployment.yaml

echo "⏳ Waiting for deployment to be ready..."
kubectl wait --for=condition=available --timeout=300s deployment/rayin-enhanced -n rayin-platform

echo "✅ Enhanced RAYIN deployment complete!"
kubectl get pods -n rayin-platform -l app=rayin-enhanced