#!/bin/bash

# Check if node is installed
if ! command -v node &> /dev/null; then
    echo "Node.js is not installed. Please install Node.js first."
    exit 1
fi

# Auto update
if [ -d .git ]; then
    echo "Checking for updates..."
    git pull
fi

# Install dependencies if node_modules doesn't exist
if [ ! -d "node_modules" ]; then
    echo "node_modules not found, installing dependencies..."
    npm install
fi

# Start the WebDAV server
echo "Starting WebDAV server..."
node webdav.js
