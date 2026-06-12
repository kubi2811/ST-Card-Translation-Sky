#!/bin/bash
set -e

echo "======================================="
echo "Updating Application..."
echo "======================================="
echo ""

echo "Pulling latest changes from GitHub..."
if ! git pull; then
    echo ""
    echo "======================================="
    echo "  [ERROR] Failed to pull changes from GitHub!"
    echo "  Please resolve any local conflicts or changes and try again."
    echo "  Common solution: run 'git stash' to temporarily save changes."
    echo "======================================="
    exit 1
fi

echo ""
echo "Installing new dependencies..."
if ! npm install; then
    echo ""
    echo "======================================="
    echo "  [ERROR] Failed to install dependencies!"
    echo "======================================="
    exit 1
fi

echo ""
echo "======================================="
echo "Update complete! You can now start the app."
echo "======================================="

