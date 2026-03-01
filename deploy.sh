#!/bin/bash
set -euo pipefail

STACK_NAME="memory-mcp"
REGION="us-east-1"

if [ -z "${VPC_ID:-}" ] || [ -z "${SUBNET_IDS:-}" ]; then
  echo "Required env vars: VPC_ID, SUBNET_IDS (comma-separated public subnet IDs)."
  echo "Example: VPC_ID=vpc-abc123 SUBNET_IDS=subnet-abc,subnet-def ./deploy.sh"
  exit 1
fi

echo "==> Deploying SAM stack..."
sam build && sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset \
  --parameter-overrides "VpcId=$VPC_ID" "SubnetIds=$SUBNET_IDS"

echo "==> Fetching stack outputs..."
ACCOUNT_ID=$(aws sts get-caller-identity --query Account --output text)
ECR_REPO="${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com/${STACK_NAME}-hugo-builder"

echo "==> Building Hugo builder Docker image..."
docker build --platform linux/arm64 -t "${STACK_NAME}-hugo-builder" -f site/Dockerfile .

echo "==> Pushing to ECR..."
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "${ACCOUNT_ID}.dkr.ecr.${REGION}.amazonaws.com"
docker tag "${STACK_NAME}-hugo-builder:latest" "${ECR_REPO}:latest"
docker push "${ECR_REPO}:latest"

echo ""
echo "==> Deploy complete!"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output table
