#!/bin/bash
set -euo pipefail

STACK_NAME="memory-mcp"
REGION="us-east-1"

echo "==> Deploying SAM stack..."
sam build && sam deploy \
  --stack-name "$STACK_NAME" \
  --region "$REGION" \
  --resolve-s3 \
  --capabilities CAPABILITY_IAM \
  --no-confirm-changeset

echo ""
echo "==> Deploy complete!"
aws cloudformation describe-stacks --stack-name "$STACK_NAME" --region "$REGION" \
  --query 'Stacks[0].Outputs' --output table
