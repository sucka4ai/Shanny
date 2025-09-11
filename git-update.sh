#!/bin/bash

# Set variables
REPO_URL="https://github.com/sucka4ai/Shanny.git"
BRANCH="main"

echo "🔄 Pulling latest changes from GitHub..."
git pull --rebase $REPO_URL $BRANCH

echo "✅ Adding changed files..."
git add .

echo "📝 Committing changes..."
read -p "Enter commit message: " COMMIT_MSG
git commit -m "$COMMIT_MSG"

echo "🚀 Pushing to GitHub..."
git push $REPO_URL $BRANCH

echo "🎉 Done! All changes pushed to GitHub."


